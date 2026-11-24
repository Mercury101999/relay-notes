import { test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const enabled = process.env.UPDATE_SHOTS === '1';

async function shot(page: Page, name: string) {
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: `docs/screenshots/${name}.png`, animations: 'disabled' });
}

test('capture product screenshots', async ({ page }, info) => {
  test.skip(!enabled || info.project.name !== 'mobile');
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example workspace' }).click();
  await page.getByText('Inbox Triage').first().waitFor();
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((node) => node.remove()));
  await shot(page, 'home-dark');
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: /Practice syntax/ }).click();
  await page.getByRole('button', { name: 'Collapse Portfolio : StudyApp' }).click();
  const word = page.locator('.word[data-word="practice"]').first();
  const box = await word.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();
  }
  await page.locator('.ruler-tick').first().waitFor();
  await shot(page, 'notes-editor-folded-highlight');
  await page.getByRole('button', { name: 'Queue', exact: true }).click();
  await page.getByRole('tab', { name: 'Staged' }).click();
  await page.getByRole('button', { name: 'Cross-reference raw note' }).click();
  await page.getByTestId('crossref').waitFor();
  await page.getByTestId('crossref').evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await shot(page, 'queue-staged-crossref');
  await page.getByRole('button', { name: 'Bots', exact: true }).click();
  await page.getByRole('heading', { name: 'Bots' }).waitFor();
  await page.locator('.bot-card', { hasText: 'Code Partner' }).click();
  await page.getByLabel('Bot name').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'bots-detail');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Phase 2 roadmap').waitFor();
  await shot(page, 'settings');
  await page.getByRole('button', { name: 'Preview trim editor' }).click();
  await page.getByTestId('voice-trim').waitFor();
  await shot(page, 'voice-trim');
});
