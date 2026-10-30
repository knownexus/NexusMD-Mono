import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' }).toString()

// A repository with one modified file and one file in a merge conflict.
function makeRepo() {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'nexusmd-popout-')))
  git(dir, 'init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'edit.txt'), 'one\ntwo\n')
  writeFileSync(join(dir, 'clash.txt'), 'base\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  git(dir, 'checkout', '-qb', 'other')
  writeFileSync(join(dir, 'clash.txt'), 'theirs\n')
  git(dir, 'commit', '-qam', 'theirs')
  git(dir, 'checkout', '-q', 'main')
  writeFileSync(join(dir, 'clash.txt'), 'ours\n')
  git(dir, 'commit', '-qam', 'ours')
  try { git(dir, 'merge', 'other') } catch { /* the conflict is the point */ }
  writeFileSync(join(dir, 'edit.txt'), 'one\ntwo\nthree\n')
  return dir
}

test('the editor, diff and conflict screens open in windows of their own', async () => {
  const dir = makeRepo()
  const slashed = dir.replace(/\\/g, '/')
  const { app, win, close } = await launchApp({
    seed: { 'profile:git.config': { version: 1, repos: [{ name: 'Work', path: dir }], groups: [], roots: null, dotfiles: null, view: { group: 'All projects', collapsed: [], selected: slashed, split: 0.45, panel: 'changes', list: 'shown' } } },
  })
  try {
    await win.locator('button.nav-item', { hasText: 'Git Workspace' }).evaluate(b => b.click())
    const row = name => win.locator('.nx-gw-file', { hasText: name })
    await expect(row('edit.txt')).toBeVisible({ timeout: 30_000 })
    const popup = async (item, rowName) => {
      const known = new Set(app.windows())
      await row(rowName).dispatchEvent('contextmenu', { clientX: 60, clientY: 60 })
      await win.getByRole('menuitem', { name: item }).evaluate(b => b.click())
      await expect.poll(() => app.windows().filter(w => !known.has(w)).length, { timeout: 20_000 }).toBe(1)
      const w = app.windows().find(x => !known.has(x))
      await w.waitForLoadState('domcontentloaded')
      return w
    }

    // Editor: edit and save from the pop-out, and the file changes on disk.
    const editor = await popup('Edit in new window', 'edit.txt')
    await expect(editor.locator('.nx-popout-title')).toHaveText('edit.txt')
    const box = editor.getByRole('textbox')
    await expect(box).toContainText('three', { timeout: 15_000 })
    await box.click({ force: true })
    await editor.keyboard.press('Control+End')
    await editor.keyboard.type('four')
    await editor.keyboard.press('Control+s')
    await expect.poll(() => readFileSync(join(dir, 'edit.txt'), 'utf8')).toContain('four')

    // The same item again focuses the existing window instead of opening another.
    const before = app.windows().length
    await row('edit.txt').dispatchEvent('contextmenu', { clientX: 60, clientY: 60 })
    await win.getByRole('menuitem', { name: 'Edit in new window' }).evaluate(b => b.click())
    await win.waitForTimeout(500)
    expect(app.windows().length).toBe(before)

    // Diff: read-only, shows the change.
    const diff = await popup('Diff in new window', 'edit.txt')
    await expect(diff.getByTestId('diff-line').filter({ hasText: 'three' })).toBeVisible({ timeout: 20_000 })
    await expect(diff.getByRole('button', { name: /^Stage/ })).toHaveCount(0)

    // Conflict: the resolve screen.
    const resolve = await popup('Resolve in new window', 'clash.txt')
    await expect(resolve.locator('.nx-popout-title')).toHaveText('clash.txt')
    await expect(resolve.getByRole('button', { name: /^Use/ }).first()).toBeVisible({ timeout: 20_000 })
  } finally {
    await close()
    rmSync(dir, { recursive: true, force: true })
  }
})
