import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  return errors;
}

async function loadExample(page: Page) {
  await page.getByRole('button', { name: 'Load example workspace' }).click();
  await expect(page.getByText('Inbox Triage').first()).toBeVisible();
}

function quiet(errors: string[]) {
  return errors.filter((error) => !/favicon/i.test(error));
}

test('quick wrap, templates, formatter, and unclosed diagnostics', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = await boot(page);
  await loadExample(page);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByLabel('Title').fill('Wrap practice');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByRole('button', { name: 'Wrap block' }).click();
  await expect(page.getByLabel('Note source')).toHaveValue(/Keyword : SubClass \{/);
  await page.getByRole('button', { name: 'Templates' }).click();
  await page.getByRole('button', { name: 'App Blueprint' }).click();
  await expect(page.getByLabel('Note source')).toHaveValue(/phase_1_cut/);
  await page.getByLabel('Note source').fill('Broken {\n  chapter: (nope\n');
  await expect(page.getByTestId('diagnostics')).toContainText(/Unclosed/);
  const broken = await page.getByLabel('Note source').inputValue();
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await expect(page.getByLabel('Note source')).toHaveValue(broken);
  await page.getByLabel('Note source').fill('Portfolio:StudyApp{\noverview:(hello)\n}\n');
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await expect(page.getByLabel('Note source')).toHaveValue(/Portfolio : StudyApp \{\n  overview: \(hello\)/);
  expect(quiet(errors)).toEqual([]);
});

test('group filters, consolidate, and undo', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = await boot(page);
  await loadExample(page);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByLabel('Title').fill('Tagged sample');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await page.getByLabel('Note source').fill('Portfolio : StudyApp #pwa @PA {\n  overview: (filter me)\n}\n');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'By keyword' }).click();
  await expect(page.getByRole('button', { name: 'Consolidate into Note' })).toBeDisabled();
  await page.getByRole('button', { name: 'Filter tag pwa' }).click();
  await page.getByRole('button', { name: 'Filter mention PA' }).click();
  await expect(page.getByLabel('Select Portfolio from Tagged sample')).toBeVisible();
  await expect(page.getByLabel('Select Career from Practice syntax')).toHaveCount(0);
  await page.getByLabel('Select Portfolio from Tagged sample').check();
  await page.getByRole('button', { name: 'Consolidate into Note' }).click();
  await page.getByLabel('Consolidate folder').selectOption({ label: 'Briefs' });
  await page.getByLabel('Consolidate note').selectOption({ label: 'Weekly desk dump' });
  await expect(page.getByTestId('consolidate-privacy')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm consolidate' })).toBeDisabled();
  await page.getByLabel('Consolidate note').selectOption({ label: 'New note' });
  await page.getByLabel('New consolidated title').fill('Bundle');
  await page.getByRole('button', { name: 'Confirm consolidate' }).click();
  await expect(page.getByTestId('undo-organize')).toBeVisible();
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(page.getByRole('button', { name: /Bundle/ })).toBeVisible();
  await page.getByRole('button', { name: 'Undo consolidate' }).click();
  await expect(page.getByRole('button', { name: /Bundle/ })).toHaveCount(0);
  expect(quiet(errors)).toEqual([]);
});

test('disperse dry-run warns before a local block enters a synced note, then undoes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = await boot(page);
  await loadExample(page);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: /Practice syntax/ }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const area = page.getByLabel('Note source');
  const original = await area.inputValue();
  await area.fill(`${original}\nPortfolio : Routed #pwa @PA -> Briefs / Weekly desk dump / triage {\n  overview: (routed from local)\n}\n`);
  await page.getByRole('button', { name: 'Disperse', exact: true }).click();
  await expect(page.getByTestId('disperse-preview')).toBeVisible();
  await expect(page.getByTestId('disperse-preview')).toContainText('Weekly desk dump');
  await expect(page.getByTestId('privacy-warning')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm disperse' })).toBeDisabled();
  const routed = page.locator('.row-card', { hasText: 'Portfolio : Routed' });
  await routed.getByLabel('Save rule for Portfolio').check();
  await page.getByLabel('Confirm local to cloud').check();
  await page.getByRole('button', { name: 'Confirm disperse' }).click();
  await expect(page.getByTestId('undo-organize')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Weekly desk dump/ }).click();
  await expect(page.getByText('routed from local')).toBeVisible();
  await expect(page.getByText(/Fictional weekly dump/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo disperse' }).click();
  await expect(page.getByText('routed from local')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: /Practice syntax/ }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByLabel('Note source')).toHaveValue(/routed from local/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Rule keyword')).toHaveCount(0);
  expect(quiet(errors)).toEqual([]);
});

test('settings edits routing rules and keyword aliases', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = await boot(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Phase 2 will add/)).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Format on save' })).not.toBeChecked();
  await expect(page.getByText('open block', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.getByLabel('Rule keyword').fill('M.C.I');
  await page.getByLabel('Rule subclass').fill('*');
  await page.getByLabel('Rule folder').fill('2.3. M.C.I');
  await page.getByLabel('Rule note').fill('{SubClass}');
  await page.getByLabel('Rule section').fill('{Chapter}');
  await page.getByRole('button', { name: 'Add alias' }).click();
  await page.getByLabel('Alias').fill('relay notes');
  await page.getByLabel('Canonical keyword').fill('RelayNotes');
  await expect(page.getByLabel('Rule keyword')).toHaveValue('M.C.I');
  await expect(page.getByLabel('Canonical keyword')).toHaveValue('RelayNotes');
  expect(quiet(errors)).toEqual([]);
});

test('bot avatars stay round and the quick wrap stays reachable on a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  const errors = await boot(page);
  await loadExample(page);
  await page.getByRole('button', { name: 'Bots', exact: true }).click();
  await page.locator('.bot-card', { hasText: 'Code Partner' }).click();
  const metrics = await page.locator('.avatar.xl').evaluate((el) => {
    const css = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return { flexShrink: css.flexShrink, aspectRatio: css.aspectRatio, width: box.width, height: box.height };
  });
  expect(metrics.flexShrink).toBe('0');
  expect(metrics.aspectRatio === '1' || metrics.aspectRatio === '1 / 1').toBe(true);
  expect(Math.abs(metrics.width - metrics.height)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: /Practice syntax/ }).click();
  await expect(page.getByTestId('quick-wrap')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wrap block' })).toBeVisible();
  expect(quiet(errors)).toEqual([]);
});
