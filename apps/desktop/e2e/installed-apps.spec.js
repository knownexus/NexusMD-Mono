import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'

// NEXUSMD_APPS stands in for the installer's choice while every app is still in one bundle.
async function withApps(apps, fn) {
  const prev = process.env.NEXUSMD_APPS
  if (apps) process.env.NEXUSMD_APPS = apps
  else delete process.env.NEXUSMD_APPS
  const launched = await launchApp()
  try { await fn(launched.win) } finally {
    await launched.close()
    if (prev === undefined) delete process.env.NEXUSMD_APPS
    else process.env.NEXUSMD_APPS = prev
  }
}

const item = (win, label) => win.locator('button.nav-item', { hasText: label })
// The screen showing, by the top bar's title. One app with one screen has no sidebar (isBareStandalone),
// so its sidebar entry can't be the check.
const showing = (win, label) => expect(win.locator('header.topbar h1')).toHaveText(label, { timeout: 15_000 })
// Settings is a sidebar entry, or with no sidebar the top bar's Settings button.
async function openSettings(win) {
  const nav = item(win, 'Settings')
  if (await nav.count()) await nav.evaluate(b => b.click())
  else await win.getByRole('button', { name: 'Settings', exact: true }).click()
}

test('with every app installed the sidebar is unchanged', async () => {
  await withApps(null, async win => {
    for (const label of ['Dashboard', 'Calendar', 'Planner', 'Git Workspace', 'Database']) {
      await expect(item(win, label)).toHaveCount(1)
    }
  })
})

test('only the installed apps appear, and the app opens on one of them', async () => {
  await withApps('git,planner', async win => {
    await expect(item(win, 'Git Workspace')).toHaveCount(1)
    await expect(item(win, 'Planner')).toHaveCount(1)
    await expect(item(win, 'Settings')).toHaveCount(1)
    for (const label of ['Dashboard', 'Calendar', 'Pull Requests', 'Database', 'Dev Environment']) {
      await expect(item(win, label)).toHaveCount(0)
    }
    // Planner comes before Git in the usual order, so it is the first view.
    await expect(item(win, 'Planner')).toHaveClass(/active/)
  })
})

test('an app that is not installed gets no preload bridge', async () => {
  await withApps('planner', async win => {
    expect(await win.evaluate(() => typeof window.electronAPI.git)).toBe('undefined')
    expect(await win.evaluate(() => typeof window.electronAPI.popout)).toBe('undefined')
    expect(await win.evaluate(() => typeof window.electronAPI.file)).toBe('object')   // the shell's own bridge stays
  })
  await withApps('git', async win => {
    expect(await win.evaluate(() => typeof window.electronAPI.git.status)).toBe('function')
    expect(await win.evaluate(() => typeof window.electronAPI.popout.open)).toBe('function')
  })
})

test('one app with one screen has no sidebar, and Settings opens from the top bar', async () => {
  await withApps('devenv', async win => {
    await showing(win, 'Dev Environment')
    await expect(win.locator('button.nav-item')).toHaveCount(0)
    await openSettings(win)
    await showing(win, 'Settings')
    await win.getByRole('button', { name: 'Back to Dev Environment' }).click()
    await showing(win, 'Dev Environment')
  })
})

test('Dev Environment works as the only installed app', async () => {
  await withApps('devenv', async win => {
    await showing(win, 'Dev Environment')
    for (const label of ['Git Workspace', 'Dashboard']) await expect(item(win, label)).toHaveCount(0)
    const api = await win.evaluate(() => ({
      run: typeof window.electronAPI.devenv.run,
      onLine: typeof window.electronAPI.devenv.onLine,
      git: typeof window.electronAPI.git,
    }))
    expect(api).toEqual({ run: 'function', onLine: 'function', git: 'undefined' })
    // Its run provider wraps the shell, and the screen renders under it without errors.
    const errors = []
    win.on('pageerror', e => errors.push(String(e)))
    await win.waitForTimeout(800)
    expect(errors).toEqual([])
    await expect(win.locator('body')).not.toContainText('Something went wrong')
  })
})

test('the Dashboard\'s Quick note needs the Planner', async () => {
  await withApps(null, async win => {
    await item(win, 'Dashboard').click()
    await expect(win.getByRole('button', { name: /Quick note/ })).toHaveCount(1)
  })
  await withApps('work', async win => {
    await expect(item(win, 'Dashboard')).toHaveClass(/active/)
    await expect(win.getByRole('button', { name: /New work item/ })).toHaveCount(1)   // the Dashboard did render
    await expect(win.getByRole('button', { name: /Quick note/ })).toHaveCount(0)
  })
})

test('the Planner and Confidential Settings tabs follow the apps that own them', async () => {
  const settingsTabs = async win => {
    await openSettings(win)
    await expect(win.getByRole('button', { name: 'Appearance' })).toBeVisible({ timeout: 15_000 })
    return win.locator('nav button').allInnerTexts()
  }
  await withApps('git', async win => {
    const tabs = await settingsTabs(win)
    expect(tabs.join('|')).not.toMatch(/Planner|Confidential/)
  })
  await withApps('planner', async win => {
    const tabs = (await settingsTabs(win)).join('|')
    expect(tabs).toMatch(/Planner/)
    expect(tabs).toMatch(/Confidential/)
  })
})

test('Planner and Calendar each work as the only installed app', async () => {
  for (const [apps, label] of [['planner', 'Planner'], ['calendar', 'Calendar']]) {
    await withApps(apps, async win => {
      await showing(win, label)
      const errors = []
      win.on('pageerror', e => errors.push(String(e)))
      await win.waitForTimeout(1000)
      expect(errors).toEqual([])
      await expect(win.locator('body')).not.toContainText('Something went wrong')
      expect(await win.locator('main, .page, [class*="planner"], [class*="cal"]').count()).toBeGreaterThan(0)
    })
  }
})

test('Database and API Client bring their own bridge and nothing else', async () => {
  await withApps('database', async win => {
    await showing(win, 'Database')
    expect(await win.evaluate(() => [typeof window.electronAPI.dbManager.connect, typeof window.electronAPI.apiClient])).toEqual(['function', 'undefined'])
  })
  await withApps('api-client', async win => {
    await showing(win, 'API Client')
    expect(await win.evaluate(() => [typeof window.electronAPI.apiClient.script.run, typeof window.electronAPI.dbManager])).toEqual(['function', 'undefined'])
  })
})

test('Notes and Documents each work as the only installed app', async () => {
  for (const [apps, label] of [['notes', 'Notes'], ['documents', 'Documents']]) {
    await withApps(apps, async win => {
      await showing(win, label)
      const errors = []
      win.on('pageerror', e => errors.push(String(e)))
      await win.waitForTimeout(1000)
      expect(errors).toEqual([])
      await expect(win.locator('body')).not.toContainText('Something went wrong')
    })
  }
})

test('the Database connections card appears in Settings only with the Database app', async () => {
  const hasCard = async win => {
    await openSettings(win)
    await win.getByRole('button', { name: 'Integrations' }).evaluate(b => b.click())
    await expect(win.locator('body')).toContainText('Integrations', { timeout: 15_000 })
    return win.getByText('Database Connections').count()
  }
  await withApps('database', async win => { expect(await hasCard(win)).toBeGreaterThan(0) })
  await withApps('git', async win => { expect(await hasCard(win)).toBe(0) })
})
