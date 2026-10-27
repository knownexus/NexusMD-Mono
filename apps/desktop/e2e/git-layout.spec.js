import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' })

// A repository with one changed file at the root and one new file in a folder.
function makeRepo() {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'nexusmd-git-layout-')))
  git(dir, 'init', '-q', '-b', 'main')
  mkdirSync(join(dir, 'docs'))
  writeFileSync(join(dir, 'README.md'), '# Hello\n')
  writeFileSync(join(dir, 'docs', 'old.md'), 'old\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  writeFileSync(join(dir, 'README.md'), '# Hello again\n')
  writeFileSync(join(dir, 'docs', 'new.md'), 'new\n')
  return dir
}
const seed = (dir, panel) => ({
  'profile:git.config': {
    version: 1, repos: [{ name: 'Work', path: dir }], groups: [], roots: null, dotfiles: null,
    view: { group: 'All projects', collapsed: [], selected: dir.replace(/\\/g, '/'), split: 0.45, panel, list: 'shown' },
  },
})
const openGit = win => win.locator('button.nav-item', { hasText: 'Git Workspace' }).evaluate(b => b.click())
const listWidth = win => win.locator('.nx-gw-aside').evaluate(el => Math.round(el.getBoundingClientRect().width))

test('the branch list is resized by dragging its divider, and keeps its width', async () => {
  const dir = makeRepo()
  try {
    const { win, close } = await launchApp({ seed: seed(dir, 'changes') })
    try {
      await openGit(win)
      const handle = win.getByRole('separator', { name: 'Resize branch list' })
      await expect(handle).toBeVisible({ timeout: 30_000 })
      const before = await listWidth(win)
      const box = await handle.boundingBox()
      await win.mouse.move(box.x + box.width / 2, box.y + 40)
      await win.mouse.down()
      await win.mouse.move(box.x + 150, box.y + 40, { steps: 5 })
      await win.mouse.up()
      await expect.poll(() => listWidth(win)).toBeGreaterThan(before + 100)
      const after = await listWidth(win)

      await win.reload()
      await openGit(win)
      await expect(win.getByRole('separator', { name: 'Resize branch list' })).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => listWidth(win)).toBe(after)

      // A double-click puts the default back.
      await win.getByRole('separator', { name: 'Resize branch list' }).dblclick()
      await expect.poll(() => listWidth(win)).toBe(before)
    } finally { await close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the Files tab marks added and modified files, and folders holding them', async () => {
  const dir = makeRepo()
  try {
    const { win, close } = await launchApp({ seed: seed(dir, 'files') })
    try {
      await openGit(win)
      const row = name => win.getByRole('treeitem').filter({ hasText: name })
      await expect(row('README.md')).toBeVisible({ timeout: 30_000 })
      await expect(row('README.md').locator('.nx-gw-tree-code')).toHaveText('M')
      await expect(row('docs').locator('.nx-gw-tree-dot')).toHaveCount(1)
      await row('docs').click()
      await expect(row('new.md').locator('.nx-gw-tree-code')).toHaveText('A')
      await expect(row('old.md').locator('.nx-gw-tree-code')).toHaveCount(0)
    } finally { await close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
