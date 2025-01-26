import { test, expect } from '@playwright/test';
import { config } from 'dotenv';

config();

test('go to google', async ({ page }) => {
  await page.goto('https://www.google.co.jp/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Google/);
});
