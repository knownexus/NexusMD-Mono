import { _electron as electron } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

export const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Starts the real app in a way that works without a desktop session: a throwaway profile
 * (the shared one's cache folders can be locked, which makes Electron quit right after
 * "app ready") and no GPU. `seed` is a { storageKey: value } map written to localStorage
 * before the first render (a key starting with "profile:" goes under the active profile), so a test can start with repositories already registered.
 * `prefs` is written as the main process's prefs.json (e.g. { disabledApps: ['git'] }).
 * The window stays off screen unless `headed` (or HEADED=1) is set. Returns { app, win, close }; close() removes the profile.
 */
export async function launchApp({ seed = {}, prefs = null, args = [], headed = process.env.HEADED === '1' } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'nexusmd-e2e-'))
  if (prefs) writeFileSync(join(userData, 'prefs.json'), JSON.stringify(prefs))
  const app = await electron.launch({
    args: [appDir, `--user-data-dir=${userData}`, '--disable-gpu', ...args],
    env: { ...process.env, ...(headed ? {} : { NEXUSMD_HIDDEN: '1' }) },
  })
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // Nothing seeds a profile: a fresh install shows the first-run gate. Make one here (what filling the gate in
  // would store) so the tests land in the shell, then reload into it along with any seed.
  await win.evaluate(s => {
    if (!localStorage.getItem('nexusmd.activeProfileId')) {
      const id = 'e2e'
      localStorage.setItem('nexusmd.profiles', JSON.stringify([{ id, name: 'E2E', initials: 'E2', color: '#9a7e22', type: 'manual', createdAt: Date.now() }]))
      localStorage.setItem('nexusmd.activeProfileId', id)
    }
    const id = localStorage.getItem('nexusmd.activeProfileId')
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k.startsWith('profile:') ? `nexusmd.p.${id}.${k.slice(8)}` : k, JSON.stringify(v))
  }, seed)
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  // A file given on the command line was handed over before this reload and is lost with it. Hand it over again
  // the way a second launch does.
  if (args.some(a => !a.startsWith('-'))) await app.evaluate(({ app: a }) => a.emit('second-instance', {}, process.argv, process.cwd()))
  return {
    app, win,
    async close() {
      await app.close().catch(() => {})
      rmSync(userData, { recursive: true, force: true })
    },
  }
}
