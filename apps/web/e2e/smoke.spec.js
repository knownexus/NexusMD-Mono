import { test, expect } from '@playwright/test'

test.describe('web app smoke', () => {
  test('mounts the React app into #root', async ({ page }) => {
    await page.goto('/')
    const root = page.locator('#root')
    await expect(root).toBeAttached()
    // The app renders content (setup flow or dashboard) within a few seconds.
    await expect(root).not.toBeEmpty({ timeout: 15_000 })
  })

  test('serves the SPA shell with a title', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()
    await expect(page).toHaveTitle(/.+/)
  })
})
