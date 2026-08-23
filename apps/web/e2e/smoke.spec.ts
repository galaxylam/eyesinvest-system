import { test, expect } from '@playwright/test';

test.describe('Phase 1 smoke', () => {
  test('home renders dark by default', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('h1')).toContainText(/investment/i);
  });

  test('language switcher moves URL to /zh-HK', async ({ page }) => {
    await page.goto('/en');
    await page.getByLabel('Language').selectOption('zh-HK');
    await expect(page).toHaveURL(/\/zh-HK/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-HK');
  });

  test('search returns AAPL result', async ({ page }) => {
    await page.goto('/en/search?q=AAPL');
    await expect(page.getByText('Apple')).toBeVisible();
  });

  test('stock detail page renders chart', async ({ page }) => {
    await page.goto('/en/stocks/AAPL');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Apple/);
    // Chart container rendered by TradingView Lightweight Charts
    await expect(page.locator('canvas')).toBeVisible();
  });
});
