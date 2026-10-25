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
