// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { appsNsh, readApps, checklistColumns, MAX_ROWS } from './gen-apps-nsh.mjs'
import { stagedPackageJson, productionClosure } from './stage.mjs'

const apps = readApps()
const nsh = readFileSync(join(import.meta.dirname, 'installer.nsh'), 'utf8')

describe('the list of apps the installer offers', () => {
  it('has every app, once, in the order of the sidebar', () => {
    expect(apps.map(a => a.id).sort()).toEqual(['api-client', 'calendar', 'database', 'devenv', 'documents', 'editor', 'git', 'notes', 'planner', 'time', 'work'])
    const orders = apps.map(a => a.order ?? 0)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })

  it('names each app\'s label and product name for the checklist and the shortcut', () => {
    const out = appsNsh([{ id: 'git', label: 'Git Workspace', productName: 'NexusMD Git Workspace' }], 'C:/apps')
    expect(out).toContain('!define NEXUS_APPS_DIR "C:/apps"')
    expect(out).toContain('!insertmacro ${macro} 0 "git" "Git Workspace" "NexusMD Git Workspace"')
  })

  it('escapes what NSIS would read as a variable or the end of a string', () => {
    const out = appsNsh([{ id: 'x', label: 'A "quoted" $name', productName: 'P' }], 'C:/a')
    expect(out).toContain('"A $\\"quoted$\\" $$name"')
  })

  it('gives every app an icon for its shortcut', () => {
    for (const { id } of apps) expect(existsSync(join(import.meta.dirname, '..', '..', '..', 'modules', id, 'assets', 'icon.ico')), id).toBe(true)
  })
})

describe('what goes inside the installed application\'s asar', () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))

  it('lists only what the main process needs, and none of the apps', () => {
    const staged = stagedPackageJson(pkg)
    expect(Object.keys(staged.dependencies).sort()).toEqual(['@nexusmd/main-kit', '@nexusmd/trace', 'electron-log', 'electron-updater'])
    expect(staged.version).toBe(pkg.version)
    expect(staged.main).toBe('electron/main.cjs')
  })

  it('brings those packages\' own dependencies, and no app package or heavy library', () => {
    const names = [...productionClosure(['electron-log', 'electron-updater', '@nexusmd/main-kit']).keys()]
    expect(names).toContain('builder-util-runtime')
    expect(names.filter(n => n.startsWith('@nexusmd/app-') || n === 'mssql' || n.startsWith('@codemirror'))).toEqual([])
  })
})

describe('the checklist page', () => {
  // installer.nsh's NxCreateRow, in JS: where each app's checkbox goes (x in %, y in dialog units).
  const place = (i, cols) => ({ x: (i % cols) * Math.floor(100 / cols), w: Math.floor(100 / cols) - 2, y: Math.floor(i / cols) * 14 + 32 })

  it('lays the checkboxes out from the generated column count, not a fixed one', () => {
    expect(nsh).toContain('${i} % ${NEXUS_APP_COLS}')
    expect(nsh).toContain('${i} / ${NEXUS_APP_COLS}')
    expect(nsh).not.toMatch(/\$\{i\} [/%] 5\b/)
    expect(appsNsh(apps, 'C:\\apps')).toContain(`!define NEXUS_APP_COLS ${checklistColumns(apps.length)}`)
  })

  it('puts every app on the page, so each can be ticked (the 11th, Time, sat off the right edge)', () => {
    for (const count of [1, 10, apps.length, 11, 21]) {
      const cols = checklistColumns(count)
      for (let i = 0; i < count; i++) {
        const { x, w, y } = place(i, cols)
        expect(x + w).toBeLessThanOrEqual(100)
        expect(y).toBeLessThanOrEqual(32 + (MAX_ROWS - 1) * 14)
      }
    }
    expect(checklistColumns(10)).toBe(2)
    expect(checklistColumns(11)).toBe(3)
    expect(() => checklistColumns(22)).toThrow(/don't fit/)
  })
})

describe('installer.nsh', () => {
  it('copies only ticked apps, names a single app\'s shortcuts after it, and keeps the selection on update', () => {
    expect(nsh).toContain('File /r "${NEXUS_APPS_DIR}\\${id}\\*.*"')
    expect(nsh).toMatch(/\$\{If\} \$NxSel\$\{i\} == 1\s+SetOutPath/)
    expect(nsh).toContain('/APPS=')
    expect(nsh).toMatch(/\$\{If\} \$\{isUpdated\}\s+Abort/)
    expect(nsh).toContain('ShortcutName "$NxOneName"')
  })
})

describe('publishing the Windows build', () => {
  const winConfig = async () => {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('../electron-builder.win.cjs')
  }
  const pkg = () => JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'))

  // With different kinds, electron-builder skips the upload when another platform has already created
  // the release as the other kind, so Windows went missing from 1.2.0.
  it('publishes the same kind of release as Mac and Linux', async () => {
    expect((await winConfig()).publish).toEqual(pkg().build.publish)
  })

  // Published as each platform finished, a release could be the latest before its latest.yml was
  // uploaded, and the app's updater failed with a 404 (1.2.3). Every platform uploads to a draft, and
  // the workflow publishes it only after all of them have.
  it('uploads to a draft that the release workflow publishes once every platform is in', async () => {
    expect((await winConfig()).publish.releaseType).toBe('draft')
    const workflow = readFileSync(join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'release-desktop.yml'), 'utf8')
    expect(workflow).toMatch(/^ {2}publish:\n(?: {4}.*\n)*? {4}needs: build\n/m)
    expect(workflow).toContain('gh release edit "$GITHUB_REF_NAME" --draft=false')
  })
})

describe('offering NexusMD as an app to open files with', () => {
  const root = join(import.meta.dirname, '..')
  const require = createRequire(import.meta.url)
  const winConfig = (testInstaller = false) => {
    const file = require.resolve('../electron-builder.win.cjs')
    const before = process.env.NEXUSMD_INSTALLER_TEST
    delete require.cache[file]
    if (testInstaller) process.env.NEXUSMD_INSTALLER_TEST = '1'; else delete process.env.NEXUSMD_INSTALLER_TEST
    try { return require(file) } finally {
      delete require.cache[file]
      if (before === undefined) delete process.env.NEXUSMD_INSTALLER_TEST; else process.env.NEXUSMD_INSTALLER_TEST = before
    }
  }
  const extensions = list => list.flatMap(a => [].concat(a.ext))
  const pkg = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  it('lists the same file types as the Android app, so a file opens the same way on both', () => {
    const manifest = readFileSync(join(root, '..', 'app', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8')
    const android = new Set([...manifest.matchAll(/pathPattern="\.\*\\\\\.([A-Za-z0-9]+)"/g)].map(m => m[1].toLowerCase()))
    expect(android.size).toBeGreaterThan(20)
    expect(new Set(extensions(require('../file-types.cjs').fileAssociations))).toEqual(android)
  })

  it('names Markdown and JSON on their own, and gives every type a name and a role', () => {
    const list = require('../file-types.cjs').fileAssociations
    expect(list.find(a => a.name === 'Markdown document').ext).toEqual(['md', 'markdown'])
    expect(list.find(a => a.name === 'JSON file').ext).toEqual(['json'])
    for (const a of list) { expect(a.name).toBeTruthy(); expect(a.role).toBe('Editor') }
  })

  it('registers them in the Windows installer, and in the Mac and Linux builds', () => {
    const list = require('../file-types.cjs').fileAssociations
    expect(winConfig().fileAssociations).toEqual(list)
    expect(pkg().build.fileAssociations).toEqual(list)
  })

  it('does not take them over in the test installer, which must leave a real install alone', () => {
    expect(winConfig(true).fileAssociations).toBeUndefined()
  })
})
