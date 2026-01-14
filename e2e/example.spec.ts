import { test, expect } from '@playwright/test'

test('homepage has correct title', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Bugwatch/)
})

test('homepage loads successfully', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})
