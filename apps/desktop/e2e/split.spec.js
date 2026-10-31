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
  time: ['Copy as markdown'],
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
  // Where downloaded app updates go (userData/apps in an installed build); empty unless a test fills it.
  const updates = join(root, 'updates')
  mkdirSync(updates)
  return { root, apps, updates }
}

async function withInstalled(ids, fn, { prepare, launch = {} } = {}) {
  const installed = install(ids)
  prepare?.(installed)
  const saved = {
    apps: process.env.NEXUSMD_APPS_DIR, shell: process.env.NEXUSMD_SHELL_DIR, narrow: process.env.NEXUSMD_APPS,
    updates: process.env.NEXUSMD_APP_UPDATES_DIR,
  }
  process.env.NEXUSMD_APPS_DIR = installed.apps
  process.env.NEXUSMD_SHELL_DIR = shellDir
  process.env.NEXUSMD_APP_UPDATES_DIR = installed.updates
  delete process.env.NEXUSMD_APPS
  const launched = await launchApp(launch)
  try { await fn({ ...launched, ...installed }) } finally {
    await launched.close()
    for (const [key, value] of [
      ['NEXUSMD_APPS_DIR', saved.apps], ['NEXUSMD_SHELL_DIR', saved.shell], ['NEXUSMD_APPS', saved.narrow],
      ['NEXUSMD_APP_UPDATES_DIR', saved.updates],
    ]) {
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
      // Markdown opens rendered.
      await expect(win.getByLabel('Preview of README.md')).toContainText('From a split install')
    }, { launch: { seed } })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('a nexusmd://open link the app was started with opens that app\'s screen', async () => {
  await withInstalled(['git', 'notes'], async ({ win }) => {
    await expect(item(win, 'Notes')).toHaveClass(/active/, { timeout: 30_000 })
  }, { launch: { args: ['nexusmd://open/notes'] } })
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

// A downloaded version of an installed app: its folder, with the manifest changed as given.
function download(updates, id, version, change = m => m) {
  const dir = join(updates, id, version)
  cpSync(join(appsBuilt, id), dir, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(dir, 'app.manifest.json'), 'utf8'))
  writeFileSync(join(dir, 'app.manifest.json'), JSON.stringify(change({ ...manifest, version })))
}
// A Git version newer than any real release.
const UPDATE = '99.0.0'
const relabel = label => m => ({ ...m, nav: m.nav.map(n => ({ ...n, label })) })

test('an installed app runs its newest downloaded version, unless that needs a newer shell', async () => {
  await withInstalled(['git', 'notes'], async ({ win }) => {
    await expect(item(win, 'Notes')).toBeVisible({ timeout: 30_000 })
    await expect(item(win, 'Git Updated')).toHaveCount(1)
    await expect(item(win, 'Git Too New')).toHaveCount(0)
    // Its code, stylesheet and preload bridge came from the downloaded folder.
    expect(await win.evaluate(v => [...document.styleSheets].some(s => (s.href || '').includes(`/updates/git/${v}/renderer/`)), UPDATE)).toBe(true)
    expect(await win.evaluate(() => typeof window.electronAPI.git?.status)).toBe('function')
  }, {
    prepare: ({ updates }) => {
      download(updates, 'git', UPDATE, relabel('Git Updated'))
      download(updates, 'git', '999.0.0', m => ({ ...relabel('Git Too New')(m), requires: { shellApi: 99 } }))
      download(updates, 'notes', '0.0.1', relabel('Notes Older'))      // older than installed: not used
    },
  })
})

test('a downloaded version marked bad is passed over for the installed one', async () => {
  await withInstalled(['git', 'notes'], async ({ win }) => {
    await expect(item(win, 'Notes')).toBeVisible({ timeout: 30_000 })
    await expect(item(win, 'Git Workspace')).toHaveCount(1)
    await expect(item(win, 'Git Updated')).toHaveCount(0)
  }, {
    prepare: ({ updates }) => {
      download(updates, 'git', UPDATE, relabel('Git Updated'))
      writeFileSync(join(updates, 'state.json'), JSON.stringify({ apps: { git: { bad: [UPDATE] } } }))
    },
  })
})

// What release-apps.yml would publish for Git UPDATE, served the way the apps-latest release is, and
// the environment that points the app at it (checking `delayMs` after launch). close() takes it down.
async function publishGitUpdate({ delayMs = 0 } = {}) {
  const { createServer } = await import('node:http')
  const { generateKeyPairSync } = await import('node:crypto')
  const { emptyIndex, setShell, addApp } = await import('../build/app-release.mjs')
  const { signIndex } = (await import('../electron/app-package.cjs')).default
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  const site = realpathSync.native(mkdtempSync(join(tmpdir(), 'nexusmd-apps-site-')))
  const release = join(site, 'built-git')
  download(site, 'git', UPDATE, relabel('Git Updated'))
  cpSync(join(site, 'git', UPDATE), release, { recursive: true })
  // The NexusMD this stands in for gives the shell API of this build (setShell's default), so a Git
  // that needs the current API is publishable. A fixed number here goes stale each time it is raised.
  const added = addApp(setShell(emptyIndex(), '1.2.5'), 'git', { dir: release, version: UPDATE })
  const files = { [`/${added.entry.file}`]: added.data, '/apps-index.json': Buffer.from(JSON.stringify(added.index)) }
  files['/apps-index.json.sig'] = Buffer.from(signIndex(files['/apps-index.json'], privateKey.export({ type: 'pkcs8', format: 'pem' })))
  const server = createServer((req, res) => {
    const body = files[req.url]
    res.writeHead(body ? 200 : 404).end(body)
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const env = {
    NEXUSMD_APPS_INDEX_URL: `http://127.0.0.1:${server.address().port}/apps-index.json`,
    NEXUSMD_APPS_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
    NEXUSMD_APP_UPDATE_DELAY_MS: String(delayMs),
  }
  Object.assign(process.env, env)
  return {
    close() {
      for (const key of Object.keys(env)) delete process.env[key]
      server.close()
      rmSync(site, { recursive: true, force: true })
    },
  }
}

test('a published app update is downloaded, checked, and run from the next launch', async () => {
  const published = await publishGitUpdate()
  const installed = install(['git', 'notes'])
  try {
    // First launch: the installed Git runs, and UPDATE arrives in the updates folder.
    await withInstalled(['git', 'notes'], async ({ win, updates }) => {
      await expect(item(win, 'Git Workspace')).toHaveCount(1, { timeout: 30_000 })
      await expect.poll(() => existsSync(join(updates, 'git', UPDATE, 'app.manifest.json')), { timeout: 30_000 }).toBe(true)
      cpSync(updates, installed.updates, { recursive: true })
    })
    // Next launch, the same installation: Git UPDATE runs.
    await withInstalled(['git', 'notes'], async ({ win }) => {
      await expect(item(win, 'Git Updated')).toHaveCount(1, { timeout: 30_000 })
    }, { prepare: ({ updates }) => cpSync(installed.updates, updates, { recursive: true }) })
  } finally {
    published.close()
    rmSync(installed.root, { recursive: true, force: true })
  }
})

test('a downloaded app update can be applied from the banner without restarting NexusMD', async () => {
  const published = await publishGitUpdate()
  try {
    await withInstalled(['git', 'notes'], async ({ app, win }) => {
      await expect(item(win, 'Git Workspace')).toHaveCount(1, { timeout: 30_000 })
      const pid = await app.evaluate(() => process.pid)
      await expect(win.getByRole('status').filter({ hasText: `Git Workspace ${UPDATE} is ready.` })).toBeVisible({ timeout: 30_000 })
      await win.getByRole('button', { name: 'Update now' }).click()
      // The window reloads onto the new version; the main process is the same one.
      await expect(item(win, 'Git Updated')).toHaveCount(1, { timeout: 30_000 })
      expect(await app.evaluate(() => process.pid)).toBe(pid)
      expect(await win.evaluate(v => [...document.styleSheets].some(s => (s.href || '').includes(`/git/${v}/renderer/`)), UPDATE)).toBe(true)
      // Git's main side was restarted on UPDATE: its handlers are registered once, and answer.
      expect(await app.evaluate(({ ipcMain }) => ipcMain._invokeHandlers.has('popout:open'))).toBe(true)
      expect(await win.evaluate(() => typeof window.electronAPI.git?.status)).toBe('function')
      await expect(win.getByRole('status')).toHaveCount(0)
    })
  } finally { published.close() }
})

test('Settings checks for app updates now and applies what it finds', async () => {
  const published = await publishGitUpdate({ delayMs: 3_600_000 })
  try {
    await withInstalled(['git', 'notes'], async ({ win }) => {
      await expect(item(win, 'Git Workspace')).toHaveCount(1, { timeout: 30_000 })
      await win.getByText('Settings').first().click()
      await win.getByText('Desktop', { exact: true }).click()
      await win.getByRole('button', { name: 'Check now' }).click()
      const card = win.locator('.set-row').filter({ hasText: `Git Workspace ${UPDATE} is ready.` })
      await expect(card).toBeVisible({ timeout: 30_000 })
      await card.getByRole('button', { name: 'Update now' }).click()
      await expect(item(win, 'Git Updated')).toHaveCount(1, { timeout: 30_000 })
    })
  } finally { published.close() }
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
