import { test, expect } from '@playwright/test';

/**
 * Live UI smoke test — requires E2E_EMAIL and E2E_PASSWORD.
 */
test.describe('backup page', () => {
  test('authenticated firm manager can open backup page', async ({ page }) => {
    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD');

    await page.goto('/');
    const loginLink = page.getByRole('link', { name: /تسجيل الدخول|دخول/i }).first();
    if (await loginLink.isVisible()) await loginLink.click();

    await page.getByLabel(/البريد|email/i).fill(email!);
    await page.getByLabel(/كلمة المرور|password/i).fill(password!);
    await page.getByRole('button', { name: /دخول|تسجيل/i }).click();

    await page.goto('/workspace/backup');
    await expect(page.getByRole('heading', { name: /النسخ الاحتياطي/i })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: /إنشاء نسخة احتياطية/i })).toBeVisible();
  });
});
