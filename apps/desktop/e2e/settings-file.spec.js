import { test, expect } from '@playwright/test'
import { launchApp } from './launch.js'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Native save/open dialogs can't be driven, so point them at a fixed file.
const stubDialogs = (app, file) => app.evaluate(({ dialog }, f) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: f })
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
}, file)

const openDataTab = async (win) => {
  await win.getByText('Settings').first().click()
  await win.getByText('Data & sync', { exact: true }).click()
  await expect(win.getByRole('heading', { name: 'Settings file' })).toBeVisible({ timeout: 15_000 })
}

test('opens as a window on start, not only in the tray', async () => {
  const { app, close } = await launchApp({ headed: true })
  try {
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true)
  } finally { await close() }
})

test('exports every setting to a file and imports it into a fresh install', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexusmd-settings-'))
  const file = join(dir, 'all.nmdsettings')
  try {
    const a = await launchApp()
    try {
      await stubDialogs(a.app, file)
      await openDataTab(a.win)
      // Written once the app is up rather than seeded: export reads storage when it runs.
      await a.win.evaluate(() => {
        localStorage.setItem(`nexusmd.p.${localStorage.getItem('nexusmd.activeProfileId')}.ado.pat`, '"tok-123"')
        localStorage.setItem('nexusmd.outputPath', '"D:/out"')
      })
      await a.win.getByRole('button', { name: /Export…/ }).click()
      await a.win.locator('input[type=password]').nth(0).fill('pw')
      await a.win.locator('input[type=password]').nth(1).fill('pw')
      await a.win.getByRole('button', { name: 'Export', exact: true }).click()
      await expect.poll(() => existsSync(file)).toBe(true)
    } finally { await a.close() }

    const b = await launchApp()
    try {
      await stubDialogs(b.app, file)
      await openDataTab(b.win)
      await b.win.getByRole('button', { name: /Import…/ }).click()
      await b.win.locator('input[type=password]').first().fill('pw')
      const reloaded = b.win.waitForEvent('load')
      await b.win.getByRole('button', { name: 'Import', exact: true }).click()
      await reloaded
      const got = await b.win.evaluate(() => {
        const id = localStorage.getItem('nexusmd.activeProfileId')
        return { pat: localStorage.getItem(`nexusmd.p.${id}.ado.pat`), out: localStorage.getItem('nexusmd.outputPath') }
      })
      expect(got).toEqual({ pat: '"tok-123"', out: '"D:/out"' })
    } finally { await b.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
