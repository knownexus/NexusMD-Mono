import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

// NEXUSMD_APPS stands in for the installer's choice while every app is still in one bundle.
async function withApps(apps, options, fn) {
  const prev = process.env.NEXUSMD_APPS
  process.env.NEXUSMD_APPS = apps
  const launched = await launchApp(options)
  try { await fn(launched) } finally {
    await launched.close()
    if (prev === undefined) delete process.env.NEXUSMD_APPS
    else process.env.NEXUSMD_APPS = prev
  }
}

const tempDir = prefix => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
const item = (win, label) => win.locator('button.nav-item', { hasText: label })

test('a file given on the command line opens in the Editor; edits save, and a change on disk is caught', async () => {
  const dir = tempDir('nexusmd-editor-')
  const file = join(dir, 'a.txt')
  writeFileSync(file, 'hello\n')
  try {
    await withApps('editor', { args: [file] }, async ({ win }) => {
      await expect(item(win, 'Editor')).toHaveClass(/active/)
      await expect(win.getByRole('tab', { name: /a\.txt/ })).toBeVisible({ timeout: 20_000 })
      const editor = win.getByRole('textbox', { name: 'Editing a.txt' })
      await expect(editor).toContainText('hello')

      // Type at the end and save with Ctrl+S.
      await editor.click()
      await win.keyboard.press('Control+End')
      await win.keyboard.type('world')
      await expect(win.getByText('Unsaved changes')).toBeVisible()
      await win.keyboard.press('Control+s')
      await expect.poll(() => readFileSync(file, 'utf8')).toBe('hello\nworld')
      await expect(win.getByText('Saved', { exact: true })).toBeVisible()

      // Someone else changes the file; the next save notices instead of overwriting.
      writeFileSync(file, 'changed elsewhere\n')
      await win.keyboard.type('!')
      await win.keyboard.press('Control+s')
      await expect(win.getByText(/changed on disk since you opened it/)).toBeVisible()
      expect(readFileSync(file, 'utf8')).toBe('changed elsewhere\n')
      await win.getByRole('button', { name: 'Overwrite it with mine' }).click()
      await expect.poll(() => readFileSync(file, 'utf8')).toContain('!')
      await expect(win.getByText(/changed on disk since you opened it/)).toHaveCount(0)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the Editor\'s file calls only take full paths and only read text', async () => {
  const dir = tempDir('nexusmd-editor-api-')
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([1, 2, 0, 3]))
  try {
    await withApps('editor', {}, async ({ win }) => {
      const attempt = (method, ...args) => win.evaluate(async ([m, a]) => {
        try { return { ok: await window.electronAPI.editor[m](...a) } } catch (e) { return { error: String(e.message) } }
      }, [method, args])
      expect((await attempt('read', 'relative.txt')).error).toMatch(/full path/)
      expect((await attempt('read', '\\\\.\\PhysicalDrive0')).error).toMatch(/Device/)
      expect((await attempt('read', join(dir, 'bin.dat'))).error).toMatch(/isn't a text file/)
      expect((await attempt('list', dir)).ok.entries.map(e => e.name)).toEqual(['bin.dat'])
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' }).toString()

function makeRepo() {
  const dir = tempDir('nexusmd-editor-git-')
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), '# From the repo\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

const gitSeed = dir => ({
  'profile:git.config': {
    version: 1, repos: [{ name: 'Work', path: dir }], groups: [], roots: null, dotfiles: null,
    view: { group: 'All projects', collapsed: [], selected: dir.replace(/\\/g, '/'), split: 0.45, panel: 'files', list: 'shown' },
  },
})

async function openFilesMenu(win) {
  await item(win, 'Git Workspace').evaluate(b => b.click())
  const readme = win.getByRole('treeitem', { name: /README\.md/ })
  await expect(readme).toBeVisible({ timeout: 30_000 })
  await readme.dispatchEvent('contextmenu', { clientX: 60, clientY: 60 })
}

test('Git\'s Files tab opens a file in the Editor when both are installed', async () => {
  const dir = makeRepo()
  try {
    await withApps('git,editor', { seed: gitSeed(dir) }, async ({ win }) => {
      await openFilesMenu(win)
      await expect(win.getByRole('menuitem', { name: 'Open with default app' })).toHaveCount(0)
      await win.getByRole('menuitem', { name: 'Open in Editor' }).click({ force: true })
      await expect(item(win, 'Editor')).toHaveClass(/active/, { timeout: 20_000 })
      await expect(win.getByRole('textbox', { name: 'Editing README.md' })).toContainText('From the repo')
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without the Editor, Git offers the default app instead', async () => {
  const dir = makeRepo()
  try {
    await withApps('git', { seed: gitSeed(dir) }, async ({ win }) => {
      await openFilesMenu(win)
      await expect(win.getByRole('menuitem', { name: 'Open in Editor' })).toHaveCount(0)
      // Offered, not clicked: that would launch an application on this machine.
      await expect(win.getByRole('menuitem', { name: 'Open with default app' })).toHaveCount(1)
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('launching the app again with a file opens it in the running Editor', async () => {
  const dir = tempDir('nexusmd-editor-second-')
  const first = join(dir, 'first.txt')
  const second = join(dir, 'second.txt')
  writeFileSync(first, 'first file\n')
  writeFileSync(second, 'second file\n')
  try {
    await withApps('editor', { args: [first] }, async ({ app, win }) => {
      await expect(win.getByRole('textbox', { name: 'Editing first.txt' })).toContainText('first file', { timeout: 20_000 })
      const userData = await app.evaluate(({ app: a }) => a.getPath('userData'))
      // The same profile means the single-instance lock is taken, so this launch hands its arguments
      // to the running app and exits.
      const { default: electronPath } = await import('electron')
      const { spawn } = await import('node:child_process')
      const child = spawn(electronPath, [join(import.meta.dirname, '..'), `--user-data-dir=${userData}`, '--disable-gpu', second], {
        env: { ...process.env, NEXUSMD_APPS: 'editor', NEXUSMD_HIDDEN: '1' }, stdio: 'ignore',
      })
      const exited = new Promise(resolve => child.on('exit', resolve))
      await expect(win.getByRole('tab', { name: /second\.txt/ })).toBeVisible({ timeout: 30_000 })
      await expect(win.getByRole('textbox', { name: 'Editing second.txt' })).toContainText('second file')
      await exited
      // The first file is still open in its own tab.
      await expect(win.getByRole('tab', { name: /first\.txt/ })).toBeVisible()
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
