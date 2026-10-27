import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

// NEXUSMD_APPS stands in for the installer's choice while every app is still in one bundle.
async function withApps(apps, fn) {
  const prev = process.env.NEXUSMD_APPS
  process.env.NEXUSMD_APPS = apps
  const launched = await launchApp()
  try { await fn(launched.win) } finally {
    await launched.close()
    if (prev === undefined) delete process.env.NEXUSMD_APPS
    else process.env.NEXUSMD_APPS = prev
  }
}

const item = (win, label) => win.locator('button.nav-item', { hasText: label })
// The screen showing, by the top bar's title: one app with one screen has no sidebar (isBareStandalone).
const showing = (win, label) => expect(win.locator('header.topbar h1')).toHaveText(label, { timeout: 15_000 })
// Settings is a sidebar entry, or with no sidebar the top bar's Settings button.
const openSettings = async win => {
  const nav = item(win, 'Settings')
  if (await nav.count()) await nav.evaluate(b => b.click())
  else await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(win.getByRole('button', { name: 'Appearance' })).toBeVisible({ timeout: 15_000 })
}
const settingsTab = (win, name) => win.getByRole('button', { name }).evaluate(b => b.click())

test('Work works as the only installed app: its seven screens, its bridge, nothing else\'s', async () => {
  await withApps('work', async win => {
    await expect(item(win, 'Dashboard')).toHaveClass(/active/)
    for (const label of ['Work Items', 'Pull Requests', 'Builds', 'Tests', 'Team', 'Triage']) await expect(item(win, label)).toHaveCount(1)
    for (const label of ['Git Workspace', 'Planner', 'Calendar', 'Editor', 'Database']) await expect(item(win, label)).toHaveCount(0)

    const api = await win.evaluate(() => [typeof window.electronAPI.jira.request, typeof window.electronAPI.git])
    expect(api).toEqual(['function', 'undefined'])

    // Each screen opens without an error (a fresh profile is a manual one, so no setup is needed).
    const errors = []
    win.on('pageerror', e => errors.push(String(e)))
    for (const label of ['Work Items', 'Pull Requests', 'Builds', 'Tests', 'Team', 'Triage', 'Dashboard']) {
      await item(win, label).evaluate(b => b.click())
      await expect(item(win, label)).toHaveClass(/active/)
      await win.waitForTimeout(250)
    }
    expect(errors).toEqual([])
    await expect(win.locator('body')).not.toContainText('Something went wrong')
  })
})

test('the refresh countdown and pause button in the top bar come with Work', async () => {
  await withApps('work', async win => {
    const topbar = win.locator('header.topbar')
    await expect(topbar).toContainText(/\d+s/, { timeout: 15_000 })
    await topbar.getByTitle('Pause auto-refresh').click()
    await expect(topbar).toContainText('paused')
    await topbar.getByTitle('Resume auto-refresh').click()
    await expect(topbar).toContainText(/\d+s/)
  })
  await withApps('git', async win => {
    const topbar = win.locator('header.topbar')
    await expect(topbar).toBeVisible()
    await expect(topbar.getByTitle('Pause auto-refresh')).toHaveCount(0)
    await expect(topbar).not.toContainText(/\d+s\b/)
  })
})

test('Work\'s Settings cards appear only when Work is installed', async () => {
  await withApps('work', async win => {
    await openSettings(win)
    await settingsTab(win, 'Integrations')
    for (const title of ['Azure DevOps Connection', 'Jira Cloud Connection', 'Work Items Display']) {
      await expect(win.getByText(title)).toBeVisible({ timeout: 15_000 })
    }
    await settingsTab(win, 'Data & sync')
    await expect(win.getByLabel('Auto-refresh interval')).toBeVisible()
    await expect(win.getByRole('button', { name: 'Clear cache' })).toBeVisible()
    await expect(win.getByRole('button', { name: 'Clear data…' })).toBeVisible()      // the shell's own row stays
    await settingsTab(win, 'Cards & Tables')
    await expect(win.getByRole('button', { name: 'Cards & Tables' })).toBeVisible()
  })
  await withApps('git', async win => {
    await openSettings(win)
    const tabs = (await win.locator('nav button').allInnerTexts()).join('|')
    expect(tabs).not.toMatch(/Cards & Tables/)
    await settingsTab(win, 'Integrations')
    await expect(win.getByText('Azure DevOps Connection')).toHaveCount(0)
    await expect(win.getByText('Jira Cloud Connection')).toHaveCount(0)
    await settingsTab(win, 'Data & sync')
    await expect(win.getByRole('button', { name: 'Clear data…' })).toBeVisible()
    await expect(win.getByLabel('Auto-refresh interval')).toHaveCount(0)
    await expect(win.getByRole('button', { name: 'Clear cache' })).toHaveCount(0)
  })
})

test('the Planner, which used to share Work\'s data provider, still works without Work', async () => {
  await withApps('planner', async win => {
    await showing(win, 'Planner')
    const errors = []
    win.on('pageerror', e => errors.push(String(e)))
    await win.waitForTimeout(1500)
    expect(errors).toEqual([])
    // Its storage is still the profile's: the migration marker is written under the profile's key.
    const keys = await win.evaluate(() => Object.keys(localStorage).filter(k => /^nexusmd\.p\..+\.planner\./.test(k)))
    expect(keys.length).toBeGreaterThan(0)
  })
})
