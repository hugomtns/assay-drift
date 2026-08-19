import { expect, test, type Page } from '@playwright/test';

async function mockLapis(page: Page, mode: 'success' | 'empty' | 'error' = 'success') {
  await page.route('**/open/v2/sample/**', async (route) => {
    if (mode === 'error') {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { detail: 'Fixture API error' } }) });
      return;
    }
    const endpoint = route.request().url().split('/').pop();
    const data = endpoint === 'aggregated'
      ? (mode === 'empty' ? [] : [{ count: 1000, date: '2025-01-01', country: 'Germany', pangoLineage: 'JN.1' }])
      : [];
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, info: { dataVersion: 'fixture', requestId: 'fixture' } }) });
  });
}

test.beforeEach(async ({ page }) => { await mockLapis(page); });

test('runs the published assay and shares the reproducible result', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /CDC N1 assay/i }).click();
  await expect(page.getByRole('table', { name: 'Assay summary' })).toBeVisible();
  await expect(page.getByText(/Limitations and data-quality notes/)).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status', { name: 'Link copy status' })).toContainText(/link copied|clipboard/i);
});

test('runs pasted oligos and supports returning to an earlier step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /paste my own oligos/i }).click();
  await page.getByLabel(/paste your oligos/i).fill('>N1-F\nTACATGTCTCTGGGACCAATGG');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/plus strand/i)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByRole('table', { name: 'Assay summary' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to Oligos' }).click();
  await expect(page.getByRole('heading', { name: /enter your oligos/i })).toBeVisible();
});

test('handles malformed links, API errors, and an empty scope', async ({ page }) => {
  await page.goto('/#q=not-a-permalink');
  await expect(page.getByRole('alert')).toContainText(/could not be read/i);

  await mockLapis(page, 'error');
  await page.getByRole('button', { name: /CDC N1 assay/i }).click();
  await expect(page.getByRole('alert')).toContainText(/Fixture API error/);

  await page.unroute('**/open/v2/sample/**');
  await mockLapis(page, 'empty');
  await page.reload();
  await page.getByRole('button', { name: /CDC N1 assay/i }).click();
  await expect(page.getByText('No SARS-CoV-2 sequences match these filters. Widen the date range or remove a filter.')).toBeVisible();
});

test('keeps core mobile content within the viewport', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile-only layout check.');
  await page.goto('/');
  await page.getByRole('button', { name: /CDC N1 assay/i }).click();
  await expect(page.getByRole('table', { name: 'Assay summary' })).toBeVisible();
  const hasVisibleOverflow = await page.locator('*').evaluateAll((nodes) => nodes.some((node: Element) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    const view = node.ownerDocument.defaultView!;
    const style = view.getComputedStyle(node);
    return style.position !== 'absolute' && rect.width > 0 && rect.right > view.innerWidth + 1;
  }));
  expect(hasVisibleOverflow).toBe(false);
  await expect(page.getByRole('heading', { name: /What the sequences show/i })).toBeVisible();
});
