import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import http from 'node:http'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test.describe('desktop shell smoke', () => {
  test('launches and renders the real shell (not the old placeholder)', async () => {
    const { win, close } = await launchApp()

    // The real shell shows the NexusMD brand and nav; the old placeholder said
    // "Phase 6 complete — adapter layer wired." which must NOT appear.
    await expect(win.getByText('NexusMD').first()).toBeVisible({ timeout: 15_000 })
    await expect(win.getByText('Dashboard').first()).toBeVisible()
    await expect(win.getByText('Phase 6 complete')).toHaveCount(0)

    await close()
  })

  test('navigates between views', async () => {
    const { win, close } = await launchApp()

    await win.getByText('Pull Requests').first().click()
    // Both the topbar and the PR view render a "Pull Requests" heading; .first()
    // keeps the locator unambiguous (strict mode) while still proving navigation.
    await expect(win.getByRole('heading', { name: 'Pull Requests' }).first()).toBeVisible()

    await close()
  })

  test('Settings shows the profile registry and Backup & Restore', async () => {
    const { win, close } = await launchApp()

    await win.getByText('Settings').first().click()
    await win.getByText('Profiles', { exact: true }).click()
    // VsProfiles (the default profile seeded on first run) + the new backup card.
    await expect(win.getByText('Default').first()).toBeVisible({ timeout: 15_000 })
    await expect(win.getByText('Backup & Restore')).toBeVisible()
    await expect(win.getByText('Back up all profiles')).toBeVisible()

    await close()
  })

  test('opens links as tabs in a shared link window', async () => {
    const { app, win, close } = await launchApp()

    // Drive the link-window manager directly (same singleton main.cjs wires up
    // to IPC) rather than depending on live ADO data being loaded in the UI.
    // openLink only accepts http(s), so serve the tab pages locally.
    const server = http.createServer((req, res) => {
      const title = decodeURIComponent(req.url.slice(1))
      res.setHeader('Content-Type', 'text/html')
      res.end(`<title>${title}</title><body>${title}</body>`)
    })
    await new Promise(done => server.listen(0, '127.0.0.1', done))
    const base = `http://127.0.0.1:${server.address().port}/`
    const managerPath = resolve(appDir, 'electron/link-window/manager.cjs')
    const openTab = (title) => app.evaluate((_electron, { path, url }) => {
      process.mainModule.require(path).openLink(url)
    }, { path: managerPath, url: base + encodeURIComponent(title) })

    await openTab('Tab One')
    const tabStrip = await app.waitForEvent('window', {
      predicate: (page) => page.url().endsWith('tab-strip.html'),
    })
    await tabStrip.waitForLoadState('domcontentloaded')
    await expect(tabStrip.locator('.tab')).toHaveCount(1)

    await openTab('Tab Two')
    await expect(tabStrip.locator('.tab')).toHaveCount(2)

    // Closing the active tab (Tab Two) falls back to the remaining tab.
    await tabStrip.locator('.tab', { hasText: 'Tab Two' }).locator('.tab-close').click()
    await expect(tabStrip.locator('.tab')).toHaveCount(1)
    await expect(tabStrip.locator('.tab')).toContainText('Tab One')

    // Closing the last tab closes the link window entirely.
    const linkWindowClosed = tabStrip.waitForEvent('close')
    await tabStrip.locator('.tab-close').click()
    await linkWindowClosed

    await close()
    server.close()
  })

  test('Git Workspace opens from the sidebar', async () => {
    const { win, close } = await launchApp()

    await win.getByText('Git Workspace').first().click()
    await expect(
      win.getByRole('tablist', { name: 'Project groups' })
        .or(win.getByText(/Git not found|Checking for git/)),
    ).toBeVisible({ timeout: 15_000 })

    await close()
  })
})
