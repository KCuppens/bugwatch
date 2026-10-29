import { test, expect } from '@playwright/test'

test('homepage has correct title', async ({ page }) => {
  await page.goto('/')
  // Brand casing differs by route ("Bugwatch" in the root layout, "BugWatch"
  // on the landing page), so match case-insensitively.
  await expect(page).toHaveTitle(/bugwatch/i)
})

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})
