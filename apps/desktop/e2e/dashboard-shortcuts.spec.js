import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './launch.js'

// Home shortcuts to one file, folder or document, opened from the Dashboard, and "Pin to Dashboard" from the screens that
// have one. Everything is seeded the way a person's own data would be: a registered repository, saved documents, a file on
// disk, and the Dashboard's widgets.

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' })
const tempDir = prefix => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
const item = (win, label) => win.locator('button.nav-item', { hasText: label }).first()
// The nav is a button list; clicking through the DOM keeps it working when the window is small or hidden.
const goTo = (win, label) => item(win, label).evaluate(b => b.click())

function makeRepo() {
  const dir = tempDir('nexusmd-shortcut-repo-')
  git(dir, 'init', '-q', '-b', 'main')
  mkdirSync(join(dir, 'docs', 'deep'), { recursive: true })
  writeFileSync(join(dir, 'README.md'), '# Hello\n')
  writeFileSync(join(dir, 'docs', 'guide.md'), 'the guide\n')
  writeFileSync(join(dir, 'docs', 'deep', 'note.md'), 'a deep note\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'init')
  return dir
}

const link = (id, config) => ({ id, type: 'link', config })
// A tile is a button named by its title and where it is. Matching only the start of a title also found the Dashboard's own
// Planner button and the sidebar's Settings, so a tile is looked up by both.
const tileIn = win => (title, sub = '') => win.getByRole('button', { name: new RegExp(`^${title}\\s*${sub}`) })

function seedFor({ repo, notesFile, extra = [] }) {
  return {
    'profile:git.config': { version: 1, repos: [{ name: 'Shortcut repo', path: repo }], groups: [], roots: null, dotfiles: null },
    'profile:md_documents': {
      docs: [
        { id: 'm-plan', name: 'Plan', autoName: 'Plan', content: '# Plan\n\nthe plan text', createdAt: 1, updatedAt: 1 },
        { id: 'm-new', name: 'Newest', autoName: 'Newest', content: '# Newest\n\nlast edited', createdAt: 2, updatedAt: 9 },
      ],
    },
    'profile:json_editor_documents': [
      { id: 'j-cfg', name: 'Settings', autoName: 'Settings', content: '{"theme":"dark"}', createdAt: 1, updatedAt: 1 },
      { id: 'j-new', name: 'Users', autoName: 'Users', content: '{"user":"ana"}', createdAt: 2, updatedAt: 9 },
    ],
    'nexusmd.tweaks': {
      homeWidgets: [
        link('k-file', { target: 'git', kind: 'file', path: '/docs/guide.md', repo: { provider: 'local', name: 'Shortcut repo' } }),
        link('k-folder', { target: 'git', kind: 'folder', path: '/docs/deep', repo: { provider: 'local', name: 'Shortcut repo' } }),
        link('k-plan', { target: 'doc', tool: 'markdown', docId: 'm-plan', name: 'Plan' }),
        link('k-cfg', { target: 'doc', tool: 'json', docId: 'j-cfg', name: 'Settings' }),
        link('k-todo', { target: 'editor', kind: 'file', path: notesFile, name: 'todo.md', platform: 'desktop' }),
        ...extra,
      ],
    },
  }
}

test('a shortcut opens the exact file, folder, document or Editor file it names', async () => {
  const repo = makeRepo()
  const notes = tempDir('nexusmd-shortcut-notes-')
  const notesFile = join(notes, 'todo.md')
  writeFileSync(notesFile, 'remember the milk\n')
  try {
    const { win, close } = await launchApp({ seed: seedFor({ repo, notesFile }) })
    try {
      const tile = tileIn(win)
      await expect(tile('guide.md')).toBeVisible({ timeout: 30_000 })

      // A repository file: Git Workspace, on the Files tab, with that file picked inside its folder.
      await tile('guide.md').click()
      const guide = win.getByRole('treeitem', { name: /guide\.md/ })
      await expect(guide).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
      await expect(win.getByRole('treeitem', { name: /^docs/ }).first()).toBeVisible()

      // A repository folder: opened, nothing picked.
      await goTo(win, 'Dashboard')
      await tile('deep').click()
      await expect(win.getByRole('treeitem', { name: /note\.md/ })).toBeVisible({ timeout: 30_000 })
      await expect(win.getByRole('treeitem', { name: /note\.md/ })).not.toHaveAttribute('aria-selected', 'true')

      // A Markdown document that is not the newest.
      await goTo(win, 'Dashboard')
      await tile('Plan', 'Markdown').click()
      await expect(win.locator('textarea').first()).toHaveValue('# Plan\n\nthe plan text', { timeout: 20_000 })

      // A JSON document that is not the newest, in the JSON tool.
      await goTo(win, 'Dashboard')
      await tile('Settings', 'JSON').click()
      await expect(win.getByRole('tab', { name: 'JSON Editor' })).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 })
      await expect(win.locator('textarea').first()).toHaveValue('{"theme":"dark"}')

      // A file for the Editor.
      await goTo(win, 'Dashboard')
      await tile('todo.md').click()
      await expect(win.getByRole('tab', { name: /todo\.md/ })).toBeVisible({ timeout: 20_000 })
      // A Markdown file opens as its preview.
      await expect(win.getByText('remember the milk')).toBeVisible()
    } finally {
      await close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(notes, { recursive: true, force: true })
  }
})

test('a shortcut to something that is gone is greyed out and says why, instead of opening', async () => {
  const repo = makeRepo()
  const notes = tempDir('nexusmd-shortcut-gone-')
  try {
    const gone = [
      link('k-doc', { target: 'doc', tool: 'markdown', docId: 'deleted', name: 'Deleted notes' }),
      link('k-ado', { target: 'git', kind: 'file', path: '/a.js', repo: { provider: 'ado', name: 'api', project: 'Core' } }),
      link('k-phone', { target: 'editor', kind: 'file', path: '/editor/a.md', name: 'phone.md', platform: 'mobile' }),
    ]
    const { win, close } = await launchApp({ seed: seedFor({ repo, notesFile: join(notes, 'x.md'), extra: gone }) })
    try {
      const tile = tileIn(win)
      await expect(tile('Deleted notes')).toBeVisible({ timeout: 30_000 })
      await expect(tile('Deleted notes')).toHaveAttribute('aria-disabled', 'true')
      // Playwright will not click what is aria-disabled; a person can, and that is what is being tested.
      await tile('Deleted notes').click({ force: true })
      await expect(win.getByText('This document no longer exists.')).toBeVisible()

      await expect(tile('a.js')).toHaveAttribute('aria-disabled', 'true')
      await tile('a.js').click({ force: true })
      await expect(win.getByText('This repository is not available on this device.')).toBeVisible()

      await expect(tile('phone.md')).toHaveAttribute('aria-disabled', 'true')
      await tile('phone.md').click({ force: true })
      await expect(win.getByText('This was made on another kind of device and opens only there.')).toBeVisible()
    } finally {
      await close()
    }
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(notes, { recursive: true, force: true })
  }
})

test('Pin to Dashboard from the Editor adds a shortcut that opens that file, and pinning it again does not add a second', async () => {
  const repo = makeRepo()
  const notes = tempDir('nexusmd-shortcut-pin-')
  const pinFile = join(notes, 'pin-me.txt')
  writeFileSync(pinFile, 'pin this\n')
  // The Dashboard (Work) and the Editor, which opens the file the app is launched on.
  const apps = process.env.NEXUSMD_APPS
  process.env.NEXUSMD_APPS = 'work,editor'
  try {
    const { app, win, close } = await launchApp({ seed: seedFor({ repo, notesFile: join(notes, 'x.md') }), args: [pinFile] })
    try {
      // The file given at launch may arrive before the Editor is listening (the Dashboard is heavier to start): once the
      // Dashboard is up, hand it over again, as a second launch does.
      await expect(win.getByRole('button', { name: 'Add widget' }).first()).toBeVisible({ timeout: 30_000 })
      await app.evaluate(({ app: a }) => a.emit('second-instance', {}, process.argv, process.cwd()))
      await expect(win.getByRole('tab', { name: /pin-me\.txt/ })).toBeVisible({ timeout: 30_000 })
      await win.getByRole('button', { name: 'Pin', exact: true }).click()
      await expect(win.getByText('Pinned to the Dashboard')).toBeVisible()
      await win.getByRole('button', { name: 'Pin', exact: true }).click()
      await expect(win.getByText('Already on the Dashboard')).toBeVisible()

      // The shell saves the tweaks under the profile's own key (the seed was written to the plain one).
      const widgets = await win.evaluate(() => {
        const key = Object.keys(localStorage).find(k => /\.p\..*tweaks$/.test(k)) || 'nexusmd.tweaks'
        return JSON.parse(localStorage.getItem(key)).homeWidgets
      })
      const pins = widgets.filter(w => w.type === 'link' && w.config.name === 'pin-me.txt')
      expect(pins).toHaveLength(1)
      expect(pins[0].config).toMatchObject({ target: 'editor', kind: 'file', platform: 'desktop' })

      await goTo(win, 'Dashboard')
      await expect(win.getByRole('button', { name: /^pin-me\.txt/ })).toBeVisible({ timeout: 20_000 })
    } finally {
      await close()
    }
  } finally {
    if (apps === undefined) delete process.env.NEXUSMD_APPS
    else process.env.NEXUSMD_APPS = apps
    rmSync(repo, { recursive: true, force: true })
    rmSync(notes, { recursive: true, force: true })
  }
})

// A repository kept as a folder of worktrees (a bare repository with its working copies inside it): the folder itself is not a
// worktree, so git refuses to be asked about it, and the picker has to ask in one of the worktrees.
function makeFolderOfWorktrees() {
  const source = makeRepo()
  const root = tempDir('nexusmd-shortcut-folder-')
  git(root, 'clone', '-q', '--bare', source, 'Pathweave')
  const bare = join(root, 'Pathweave')
  git(bare, 'worktree', 'add', '-q', join(bare, 'main'), 'main')
  return { source, root, bare }
}

test('the picker browses a repository kept as a folder of worktrees, and the shortcut it makes opens that file', async () => {
  const { source, root, bare } = makeFolderOfWorktrees()
  try {
    const seed = {
      'profile:git.config': { version: 1, repos: [{ name: 'Pathweave', path: bare }], groups: [], roots: null, dotfiles: null },
      'nexusmd.tweaks': { homeWidgets: [] },
    }
    const { win, close } = await launchApp({ seed })
    try {
      await win.locator('button', { hasText: 'Add widget' }).last().click({ timeout: 30_000 })
      const dialog = win.getByRole('dialog')
      await dialog.getByText('File or folder').click()
      await dialog.getByText('Repository file or folder').click()
      await dialog.getByText('Pathweave', { exact: true }).click()

      // Its files are listed, not an error about it not being a worktree.
      await expect(dialog.getByText('docs', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(dialog.getByText('README.md', { exact: true })).toBeVisible()
      await expect(dialog.getByText(/Not a worktree|Error invoking/)).toHaveCount(0)

      await dialog.getByText('docs', { exact: true }).click()
      await dialog.getByText('guide.md', { exact: true }).click()
      await expect(dialog.getByText('Opens', { exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Add widget' }).click()

      const tile = tileIn(win)('guide.md')
      await expect(tile).toBeVisible({ timeout: 20_000 })
      await tile.click()
      await expect(win.getByRole('treeitem', { name: /guide\.md/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    } finally {
      await close()
    }
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})
