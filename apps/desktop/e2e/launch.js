import { _electron as electron } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Starts the real app in a way that works without a desktop session: a throwaway profile
 * (the shared one's cache folders can be locked, which makes Electron quit right after
 * "app ready") and no GPU. `seed` is a { storageKey: value } map written to localStorage
 * before the first render (a key starting with "profile:" goes under the active profile), so a test can start with repositories already registered.
 * The window stays off screen unless `headed` (or HEADED=1) is set. Returns { app, win, close }; close() removes the profile.
 */
export async function launchApp({ seed = {}, args = [], headed = process.env.HEADED === '1' } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'nexusmd-e2e-'))
  const app = await electron.launch({
    args: [appDir, `--user-data-dir=${userData}`, '--disable-gpu', ...args],
    env: { ...process.env, ...(headed ? {} : { NEXUSMD_HIDDEN: '1' }) },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  if (Object.keys(seed).length) {
    await win.evaluate(s => {
      const id = localStorage.getItem('nexusmd.activeProfileId')
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k.startsWith('profile:') ? `nexusmd.p.${id}.${k.slice(8)}` : k, JSON.stringify(v))
    }, seed)
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
  }
  return {
    app, win,
    async close() {
      await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    },
  }
}
