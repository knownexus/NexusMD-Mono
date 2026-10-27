// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { appsNsh, readApps } from './gen-apps-nsh.mjs'
import { stagedPackageJson, productionClosure } from './stage.mjs'

const apps = readApps()
const nsh = readFileSync(join(import.meta.dirname, 'installer.nsh'), 'utf8')

describe('the list of apps the installer offers', () => {
  it('has every app, once, in the order of the sidebar', () => {
    expect(apps.map(a => a.id).sort()).toEqual(['api-client', 'calendar', 'database', 'devenv', 'documents', 'editor', 'git', 'notes', 'planner', 'work'])
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
    expect(Object.keys(staged.dependencies).sort()).toEqual(['@nexusmd/main-kit', 'electron-log', 'electron-updater'])
    expect(staged.version).toBe(pkg.version)
    expect(staged.main).toBe('electron/main.cjs')
  })

  it('brings those packages\' own dependencies, and no app package or heavy library', () => {
    const names = [...productionClosure(['electron-log', 'electron-updater', '@nexusmd/main-kit']).keys()]
    expect(names).toContain('builder-util-runtime')
    expect(names.filter(n => n.startsWith('@nexusmd/app-') || n === 'mssql' || n.startsWith('@codemirror'))).toEqual([])
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
