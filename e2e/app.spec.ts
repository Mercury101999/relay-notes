import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Relay Notes' })).toBeVisible();
  return errors;
}

async function loadExample(page: Page) {
  await page.getByRole('button', { name: 'Load example workspace' }).click();
  await expect(page.getByText('Inbox Triage').first()).toBeVisible();
}

test('dark command center, folding, highlights, and the overview ruler', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop covers the editor interaction');
  const errors = await boot(page);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(12, 18, 20)');
  await loadExample(page);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: /Practice syntax/ }).click();
  await expect(page.getByTestId('note-editor')).toBeVisible();
  await expect(page.getByText('React and TypeScript', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Portfolio : StudyApp' }).click();
  await expect(page.getByText(/Portfolio : StudyApp · 2 chapters/)).toBeVisible();
  await expect(page.getByText('React and TypeScript')).toHaveCount(0);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.getByLabel('Note source')).toHaveValue(/React and TypeScript/);
  await page.getByRole('button', { name: 'Fold', exact: true }).click();
  await page.getByRole('button', { name: 'Expand Portfolio : StudyApp' }).click();
  const word = page.locator('.word[data-word="practice"]').first();
  const box = await word.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  await page.mouse.up();
  await expect(page.locator('.word.hit').first()).toBeVisible();
  await expect(page.getByTestId('overview-ruler').locator('.ruler-tick').first()).toBeVisible();
  const ticks = await page.locator('.ruler-tick').count();
  expect(ticks).toBeGreaterThan(1);
  await page.locator('.ruler-tick').nth(1).click();
  await expect(page.locator('.word.current')).toBeVisible();
  expect(errors.filter((error) => !/favicon/i.test(error))).toEqual([]);
});

test('fast prompt, staged cross-reference, and approve', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = await boot(page);
  await loadExample(page);
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Bot', exact: true }).fill('Code Partner');
  await page.getByRole('textbox', { name: 'Goal', exact: true }).fill('Review the open practice diff');
  await page.getByRole('textbox', { name: 'Details', exact: true }).fill('Fictional sample constraint');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: 'Stage prompt' }).click();
  await expect(page.getByText('Review the open practice diff')).toBeVisible();
  const card = page.locator('article', { hasText: 'Sort the fictional sample inbox' });
  await card.getByRole('button', { name: 'Cross-reference raw note' }).click();
  await expect(page.getByTestId('crossref')).toContainText('Weekly desk dump');
  await expect(page.getByTestId('crossref')).toContainText('fictional');
  await card.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Sort the fictional sample inbox')).toBeVisible();
  expect(errors.filter((error) => !/favicon/i.test(error))).toEqual([]);
});

test('bot detail shows status, todos, and a prompt shortcut', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await boot(page);
  await loadExample(page);
  await page.getByRole('button', { name: 'Bots', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bots' })).toBeVisible();
  await page.locator('.bot-card', { hasText: 'Code Partner' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
  await expect(page.getByLabel('Bot name')).toHaveValue('Code Partner');
  await expect(page.getByRole('checkbox', { name: 'Review the open practice diff' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Review the open practice diff' }).check();
  await expect(page.getByRole('checkbox', { name: 'Review the open practice diff' })).toBeChecked();
  await page.getByRole('button', { name: 'New prompt for Code Partner' }).click();
  await expect(page.getByRole('combobox', { name: 'Bot', exact: true })).toHaveValue('Code Partner');
});

test('mobile shell keeps the dark theme and bottom navigation', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile');
  const errors = await boot(page);
  await expect(page.locator('.tabbar')).toBeVisible();
  await loadExample(page);
  await page.getByRole('button', { name: 'Bots', exact: true }).click();
  await expect(page.getByRole('button', { name: /Study Coach/ })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Phase 2 will add/)).toBeVisible();
  expect(errors.filter((error) => !/favicon/i.test(error))).toEqual([]);
});

test('service worker serves the app shell offline and leaves the voice model lazy', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const errors = await boot(page);
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return !!registration?.active;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const sw = await page.evaluate(async () => (await fetch('./sw.js')).text());
  expect(sw).toContain('relay-voice-v1');
  expect(sw).not.toContain('encoder_model_quantized');
  expect(sw).not.toContain('decoder_model_merged_quantized');
  await loadExample(page);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Relay Notes' })).toBeVisible();
  await expect(page.getByText('Inbox Triage').first()).toBeVisible();
  expect(errors.filter((error) => !/favicon|Failed to fetch|service worker/i.test(error))).toEqual([]);
});
