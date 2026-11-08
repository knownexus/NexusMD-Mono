import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, cpSync, mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './launch.js'

// Files the app is opened with (double-click, "Open with"), routed as on Android: Markdown and JSON become documents in the
// Documents app, anything else opens in the Editor. The OS hands the file over on the command line (Windows, Linux) or as a
// second launch while the app runs; both are driven here the way the Editor's own spec does.

// The split layout, as an installer leaves it: only the ticked apps are on the disk, and the Editor and Documents reach each other
// through the shell (capabilities), not by importing each other. split.spec.js builds the same layout.
const desktop = resolve(import.meta.dirname, '..')
const built = resolve(desktop, '..', '..', 'dist', 'desktop', 'split')
const shellDir = join(built, 'shell')

test.beforeAll(() => {
  if (existsSync(join(shellDir, 'index.html')) && existsSync(join(built, 'apps', 'documents')) && existsSync(join(built, 'apps', 'editor'))) return
  execFileSync(process.execPath, [join(desktop, 'build', 'build-split.mjs'), 'editor', 'documents'], { cwd: desktop, stdio: 'ignore', timeout: 300_000 })
})

async function withApps(ids, options, fn) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'nexusmd-split-')))
  mkdirSync(join(root, 'apps')); mkdirSync(join(root, 'updates'))
  for (const id of ids) cpSync(join(built, 'apps', id), join(root, 'apps', id), { recursive: true })
  const keys = ['NEXUSMD_APPS_DIR', 'NEXUSMD_SHELL_DIR', 'NEXUSMD_APP_UPDATES_DIR', 'NEXUSMD_APPS']
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]))
  process.env.NEXUSMD_APPS_DIR = join(root, 'apps')
  process.env.NEXUSMD_SHELL_DIR = shellDir
  process.env.NEXUSMD_APP_UPDATES_DIR = join(root, 'updates')
  delete process.env.NEXUSMD_APPS
  const launched = await launchApp(options)
  try { await fn(launched) } finally {
    await launched.close()
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
    rmSync(root, { recursive: true, force: true })
  }
}
const tempDir = prefix => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
const showing = (win, label) => expect(win.locator('header.topbar h1')).toHaveText(label, { timeout: 15_000 })

test.describe('files the app is opened with', () => {
  let dir
  test.beforeEach(() => { dir = tempDir('nexusmd-openwith-') })
  test.afterEach(() => { rmSync(dir, { recursive: true, force: true }) })
  const make = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p }

  test('a JSON file opens in the JSON editor as a copy, and the file on disk is left alone', async () => {
    const file = make('settings.json', '{"theme":"dark","sizes":[1,2]}')
    await withApps(['documents', 'editor'], { args: [file] }, async ({ win }) => {
      await showing(win, 'Documents')
      await expect(win.getByText('JSON Editor', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
      await expect(win.locator('textarea').first()).toHaveValue(/"theme":\s*"dark"/, { timeout: 20_000 })
      await expect(win.getByText('Valid JSON')).toBeVisible()
      await expect(win.getByRole('tab', { name: /settings\.json/ })).toHaveCount(0)
    })
    expect(readFileSync(file, 'utf8')).toBe('{"theme":"dark","sizes":[1,2]}')
  })

  test('a JSON file that does not parse still opens in the JSON editor, showing the error', async () => {
    const file = make('broken.json', '{"a": ')
    await withApps(['documents', 'editor'], { args: [file] }, async ({ win }) => {
      await showing(win, 'Documents')
      await expect(win.getByText('Invalid')).toBeVisible({ timeout: 20_000 })
      await expect(win.locator('textarea').first()).toHaveValue('{"a": ')
    })
  })

  test('a Markdown file opens in the Markdown tool', async () => {
    const file = make('plan.md', '# Quarterly plan\n\nShip the thing.\n')
    await withApps(['documents', 'editor'], { args: [file] }, async ({ win }) => {
      await showing(win, 'Documents')
      await expect(win.getByText('Ship the thing.').first()).toBeVisible({ timeout: 20_000 })
      await expect(win.getByRole('tab', { name: /plan\.md/ })).toHaveCount(0)
    })
  })

  test('a code file opens in the Editor, as before', async () => {
    const file = make('code.ts', 'export const answer = 42\n')
    await withApps(['documents', 'editor'], { args: [file] }, async ({ win }) => {
      await showing(win, 'Editor')
      await expect(win.getByRole('tab', { name: /code\.ts/ })).toBeVisible({ timeout: 20_000 })
      await expect(win.getByRole('textbox', { name: 'Editing code.ts' })).toContainText('answer = 42')
    })
  })

  test('a file opened while the app is running is routed the same way', async () => {
    const code = make('first.ts', 'export {}\n')
    const json = make('later.json', '{"later":true}')
    await withApps(['documents', 'editor'], { args: [code] }, async ({ app, win }) => {
      await showing(win, 'Editor')
      await app.evaluate(({ app: a }, file) => a.emit('second-instance', {}, [process.argv[0], process.argv[1], file], process.cwd()), json)
      await showing(win, 'Documents')
      await expect(win.locator('textarea').first()).toHaveValue(/"later":\s*true/, { timeout: 20_000 })
    })
  })

  test('without the Documents app, the Editor takes a JSON file as it did before', async () => {
    const file = make('only-editor.json', '{"x":1}')
    await withApps(['editor'], { args: [file] }, async ({ win }) => {
      await expect(win.getByRole('tab', { name: /only-editor\.json/ })).toBeVisible({ timeout: 20_000 })
    })
  })
})
