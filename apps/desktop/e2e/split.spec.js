import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  existsSync, mkdtempSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync, realpathSync, statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from './launch.js'

// The split layout: every app is a folder of its own, and an installer copies only the ones ticked.
// These tests install a subset into a temporary folder and run the real app against only that.
const desktop = resolve(import.meta.dirname, '..')
const built = resolve(desktop, '..', '..', 'dist', 'desktop', 'split')
const shellDir = join(built, 'shell')
const appsBuilt = join(built, 'apps')

test.beforeAll(() => {
  if (existsSync(join(shellDir, 'index.html')) && existsSync(join(appsBuilt, 'git'))) return
  execFileSync(process.execPath, [join(desktop, 'build', 'build-split.mjs')], { cwd: desktop, stdio: 'ignore', timeout: 300_000 })
})

// Something only that app's code contains, so finding it elsewhere would mean the app leaked. The
// second kind of string sits in the app's screens, which live in @nexusmd/ui's source.
const MARKERS = {
  git: ['git:resolveConflict'],
  devenv: ['devenv:profile-write'],
  editor: ['editor:take-pending'],
  database: ['db-manager:run-query', 'Table not found in demo data'],
  'api-client': ['api-client:script:run', 'Choose a collection folder first.'],
  work: ['Auto-refresh interval', 'Rise and shine, Phillip.'],
  planner: ['Carry-over prompt'],
  calendar: ['Google Calendar is not configured.', 'OutlookService not initialised'],
  documents: ['Global — find all matches'],
}
const markerList = () => Object.entries(MARKERS).flatMap(([id, markers]) => markers.map(marker => [id, marker]))

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name))
}
const mentions = (dir, marker) => filesUnder(dir).some(f => readFileSync(f, 'utf8').includes(marker))

// Copies just these apps into a fresh folder: that folder is what an installation would hold.
function install(ids) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'nexusmd-split-')))
  const apps = join(root, 'apps')
  mkdirSync(apps)
  for (const id of ids) cpSync(join(appsBuilt, id), join(apps, id), { recursive: true })
  return { root, apps }
}

async function withInstalled(ids, fn, { prepare, launch = {} } = {}) {
  const installed = install(ids)
  prepare?.(installed)
  const saved = { apps: process.env.NEXUSMD_APPS_DIR, shell: process.env.NEXUSMD_SHELL_DIR, narrow: process.env.NEXUSMD_APPS }
  process.env.NEXUSMD_APPS_DIR = installed.apps
  process.env.NEXUSMD_SHELL_DIR = shellDir
  delete process.env.NEXUSMD_APPS
  const launched = await launchApp(launch)
  try { await fn({ ...launched, ...installed }) } finally {
    await launched.close()
    for (const [key, value] of [['NEXUSMD_APPS_DIR', saved.apps], ['NEXUSMD_SHELL_DIR', saved.shell], ['NEXUSMD_APPS', saved.narrow]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(installed.root, { recursive: true, force: true })
  }
}

const item = (win, label) => win.locator('button.nav-item', { hasText: label })
// What a single-app install shows in place of a sidebar: the app's name in the title bar.
const heading = win => win.locator('header.topbar h1')

test('every marker is really in the app that owns it (so the absence checks below cannot pass by accident)', () => {
  for (const [id, marker] of markerList()) {
    expect(mentions(join(appsBuilt, id), marker), `${id} should contain "${marker}"`).toBe(true)
  }
})

test('the shell carries no app code, and no app carries another\'s', () => {
  for (const [id, marker] of markerList()) {
    expect(mentions(shellDir, marker), `the shell should not contain ${id}'s "${marker}"`).toBe(false)
    for (const other of Object.keys(MARKERS).filter(o => o !== id)) {
      expect(mentions(join(appsBuilt, other), marker), `${other} should not contain ${id}'s "${marker}"`).toBe(false)
    }
  }
})

test('installing only Git puts only Git on the disk, and the app runs on just that', async () => {
  await withInstalled(['git'], async ({ win, root, apps }) => {
    // On the disk: one app folder, and none of the other apps' code anywhere in the installation.
    expect(readdirSync(apps)).toEqual(['git'])
    for (const [id, marker] of markerList().filter(([id]) => id !== 'git')) {
      expect(mentions(root, marker), `${id} should not be installed`).toBe(false)
    }
    expect(mentions(root, MARKERS.git[0])).toBe(true)

    // In the window: Git is the whole app.
    await expect(heading(win)).toHaveText('Git Workspace', { timeout: 30_000 })
    for (const label of ['Dashboard', 'Planner', 'Calendar', 'Editor', 'Database', 'Dev Environment', 'Notes']) {
      await expect(item(win, label)).toHaveCount(0)
    }
    const bridge = await win.evaluate(() => ({
      git: typeof window.electronAPI.git?.status,
      popout: typeof window.electronAPI.popout?.open,
      editor: typeof window.electronAPI.editor,
      jira: typeof window.electronAPI.jira,
      dbManager: typeof window.electronAPI.dbManager,
    }))
    expect(bridge).toEqual({ git: 'function', popout: 'function', editor: 'undefined', jira: 'undefined', dbManager: 'undefined' })
    // Git's own stylesheet came from its folder.
    expect(await win.evaluate(() => [...document.styleSheets].some(s => (s.href || '').includes('/apps/git/renderer/')))).toBe(true)
  })
})

test('apps loaded from separate folders still work together: Git opens a file in the Editor', async () => {
  const { execFileSync: run } = await import('node:child_process')
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'nexusmd-split-repo-')))
  const git = (...args) => run('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', ...args], { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), '# From a split install\n')
  git('add', '.'); git('commit', '-qm', 'init')
  const seed = {
    'profile:git.config': { version: 1, repos: [{ name: 'Work', path: dir }], groups: [], roots: null, dotfiles: null,
      view: { group: 'All projects', collapsed: [], selected: dir.replace(/\\/g, '/'), split: 0.45, panel: 'files', list: 'shown' } },
  }
  try {
    await withInstalled(['git', 'editor'], async ({ win }) => {
      await item(win, 'Git Workspace').evaluate(b => b.click())
      const readme = win.getByRole('treeitem', { name: /README\.md/ })
      await expect(readme).toBeVisible({ timeout: 30_000 })
      await readme.dispatchEvent('contextmenu', { clientX: 60, clientY: 60 })
      await win.getByRole('menuitem', { name: 'Open in Editor' }).click({ force: true })
      await expect(item(win, 'Editor')).toHaveClass(/active/, { timeout: 20_000 })
      await expect(win.getByRole('textbox', { name: 'Editing README.md' })).toContainText('From a split install')
    }, { launch: { seed } })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('Work, Planner and Calendar find each other across folders, and only when installed', async () => {
  await withInstalled(['work', 'planner'], async ({ win }) => {
    await item(win, 'Dashboard').click()
    await expect(win.getByRole('button', { name: /Quick note/ })).toHaveCount(1)
  })
  await withInstalled(['work'], async ({ win }) => {
    await expect(item(win, 'Dashboard')).toHaveClass(/active/, { timeout: 30_000 })
    await expect(win.getByRole('button', { name: /New work item/ })).toHaveCount(1)
    await expect(win.getByRole('button', { name: /Quick note/ })).toHaveCount(0)
    await expect(win.locator('header.topbar')).toContainText(/\d+s/)                // Work's top bar slot, from its folder
    expect(await win.evaluate(() => typeof window.electronAPI.jira.request)).toBe('function')
  })
})

test('an app\'s main process is bundled with what it needs: Database (with mssql) starts from its folder', async () => {
  await withInstalled(['database'], async ({ win, apps }) => {
    await expect(heading(win)).toHaveText('Database', { timeout: 30_000 })
    const main = join(apps, 'database', 'main', 'index.cjs')
    expect(statSync(main).size).toBeGreaterThan(500_000)     // mssql and its dependencies are inside
    // The handler is registered, so asking is an answer (here a refusal of a bogus request), not "No handler".
    const outcome = await win.evaluate(async () => {
      try { return { value: await window.electronAPI.dbManager.connect('sqlite', { file: '' }) } } catch (e) { return { error: String(e.message) } }
    })
    expect(JSON.stringify(outcome)).not.toMatch(/No handler registered/)
  })
})

test('an app whose code fails to load is left out, and the others carry on', async () => {
  await withInstalled(['git', 'notes'], async ({ win }) => {
    await expect(heading(win)).toHaveText('Git Workspace', { timeout: 30_000 })
    await expect(win.locator('button.nav-item')).toHaveCount(0)
  }, { prepare: ({ apps }) => writeFileSync(join(apps, 'notes', 'renderer', 'index.js'), 'throw new Error("this app is broken")') })
})

test('a folder that is not an app, and an app with a mismatched manifest, are ignored', async () => {
  await withInstalled(['git'], async ({ win }) => {
    await expect(heading(win)).toHaveText('Git Workspace', { timeout: 30_000 })
    await expect(win.getByRole('button', { name: 'Settings' })).toHaveCount(1)      // one app only: the gear, no sidebar
  }, {
    prepare: ({ apps }) => {
      mkdirSync(join(apps, 'stray')); writeFileSync(join(apps, 'stray', 'readme.txt'), 'not an app')
      writeFileSync(join(apps, 'junk.txt'), 'x')
      cpSync(join(apps, 'git'), join(apps, 'impostor'), { recursive: true })   // its manifest still says "git"
    },
  })
})

test('with every app installed, every app loads and its screens render (no name is missing from the shared UI)', async () => {
  const ids = readdirSync(appsBuilt)
  const labels = ids.flatMap(id => JSON.parse(readFileSync(join(appsBuilt, id, 'app.manifest.json'), 'utf8')).nav.map(n => n.label))
  await withInstalled(ids, async ({ win }) => {
    await expect(item(win, labels[0])).toBeVisible({ timeout: 30_000 })
    for (const label of labels) await expect(item(win, label), `${label} should be in the sidebar`).toHaveCount(1)
    // Open each screen: a screen whose code imports something the shell does not share fails when it renders.
    const errors = []
    win.on('pageerror', e => errors.push(e.message))
    for (const label of labels) {
      await item(win, label).evaluate(b => b.click())
      await win.waitForTimeout(400)
      await expect(win.locator('#root > *').first(), `${label} should render`).toBeVisible()
    }
    expect(errors).toEqual([])
  })
})

test('an install of one app is that app alone: its name, no sidebar, Settings from the title bar', async () => {
  await withInstalled(['git'], async ({ win }) => {
    await expect(heading(win)).toHaveText('Git Workspace', { timeout: 30_000 })
    expect(await win.title()).toBe('NexusMD Git Workspace')
    await expect(win.locator('button.nav-item')).toHaveCount(0)
    await win.getByRole('button', { name: 'Settings' }).click()
    await expect(heading(win)).toHaveText('Settings')
    await win.getByRole('button', { name: 'Back to Git Workspace' }).click()
    await expect(heading(win)).toHaveText('Git Workspace')
  })
  // Several apps, or one app with several screens, keep the sidebar and the product name.
  await withInstalled(['git', 'editor'], async ({ win }) => {
    await expect(item(win, 'Editor')).toBeVisible({ timeout: 30_000 })
    expect(await win.title()).toBe('NexusMD')
  })
  await withInstalled(['work'], async ({ win }) => {
    await expect(item(win, 'Pull Requests')).toBeVisible({ timeout: 30_000 })
    expect(await win.title()).toBe('NexusMD Work')
  })
})
