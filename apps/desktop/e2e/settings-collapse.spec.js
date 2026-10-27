import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

const toggle = (win, title) => win.locator('.set-card-toggle', { hasText: title })

test('Settings sections collapse from their title bar and stay collapsed after a reload', async () => {
  const { win, close } = await launchApp()
  try {
    await win.getByText('Settings').first().click()
    await win.getByText('Profiles', { exact: true }).click()
    const backup = toggle(win, 'Backup & Restore')
    await expect(backup).toHaveAttribute('aria-expanded', 'true')
    await expect(win.getByText('Back up all profiles')).toBeVisible()

    await backup.click()
    await expect(backup).toHaveAttribute('aria-expanded', 'false')
    await expect(win.getByText('Back up all profiles')).toBeHidden()
    // The Profiles section next to it is untouched, and its header button still works.
    await expect(toggle(win, 'Profiles')).toHaveAttribute('aria-expanded', 'true')

    await win.reload()
    await win.getByText('Settings').first().click()
    await win.getByText('Profiles', { exact: true }).click()
    await expect(toggle(win, 'Backup & Restore')).toHaveAttribute('aria-expanded', 'false')
    await expect(win.getByText('Back up all profiles')).toBeHidden()

    await toggle(win, 'Backup & Restore').click()
    await expect(win.getByText('Back up all profiles')).toBeVisible()
  } finally { await close() }
})
