import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

test('sidebar entries can be hidden in Settings and shown again', async () => {
  const { win, close } = await launchApp({ seed: { 'nexusmd.tweaks': { navHidden: ['calendar', 'team'] } } })
  try {
    const item = label => win.locator('button.nav-item', { hasText: label })
    // Hidden entries are gone from the sidebar; the rest and Settings stay.
    await expect(item('Dashboard')).toHaveCount(1)
    await expect(item('Calendar')).toHaveCount(0)
    await expect(item('Team')).toHaveCount(0)
    await expect(item('Settings')).toHaveCount(1)

    // Settings lists them, unticked, and ticking one brings it back.
    await item('Settings').evaluate(b => b.click())
    await win.getByRole('button', { name: 'Appearance' }).evaluate(b => b.click())
    const calendar = win.getByRole('checkbox', { name: 'Show Calendar in the sidebar' })
    await expect(calendar).not.toBeChecked({ timeout: 15_000 })
    await calendar.evaluate(c => c.click())
    await expect(item('Calendar')).toHaveCount(1)

    // Unticking hides again, and Reset sidebar shows everything.
    await win.getByRole('checkbox', { name: 'Show Dashboard in the sidebar' }).evaluate(c => c.click())
    await expect(item('Dashboard')).toHaveCount(0)
    await win.getByRole('button', { name: 'Reset sidebar' }).evaluate(b => b.click())
    await expect(item('Dashboard')).toHaveCount(1)
    await expect(item('Team')).toHaveCount(1)
  } finally {
    await close()
  }
})
