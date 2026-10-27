import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('a switched-off app is left out, and Settings can switch it back on', async () => {
  const { app, win, close } = await launchApp({ prefs: { disabledApps: ['git'] } })
  try {
    await expect(win.getByText('Dashboard').first()).toBeVisible({ timeout: 15_000 })
    // Neither its sidebar entry nor its main-process bridge is there.
    await expect(win.locator('button.nav-item', { hasText: 'Git Workspace' })).toHaveCount(0)
    expect(await win.evaluate(() => typeof window.electronAPI.git)).toBe('undefined')

    await win.getByText('Settings').first().click()
    await win.getByText('Desktop', { exact: true }).click()
    await expect(win.getByRole('heading', { name: 'Apps' })).toBeVisible()
    const gitRow = win.locator('.set-row').filter({ has: win.locator('.t', { hasText: /^Git Workspace$/ }) })
    const gitSwitch = gitRow.locator('input[type=checkbox]')
    await expect(gitSwitch).not.toBeChecked()

    await gitRow.locator('label.tgl').click()
    await expect(gitSwitch).toBeChecked()
    await expect(win.getByRole('button', { name: 'Restart now' })).toBeVisible()
    const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
    await expect.poll(() => JSON.parse(readFileSync(join(userData, 'prefs.json'), 'utf8')).disabledApps).toEqual([])
  } finally { await close() }
})
