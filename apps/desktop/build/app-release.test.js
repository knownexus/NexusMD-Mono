// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emptyIndex, setShell, addApp, obsoleteAssets } from './app-release.mjs'
import appPackage from '../electron/app-package.cjs'

describe('app releases', () => {
  let root
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusmd-release-')) })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  function built(id, version, { shellApi = 1, main = false, ipc } = {}) {
    const dir = path.join(root, `${id}-${version}`)
    fs.mkdirSync(path.join(dir, 'renderer'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'app.manifest.json'), JSON.stringify({ id, version, requires: { shellApi }, ...(ipc ? { ipc } : {}) }))
    fs.writeFileSync(path.join(dir, 'renderer', 'index.js'), 'export default {}')
    if (main) { fs.mkdirSync(path.join(dir, 'main')); fs.writeFileSync(path.join(dir, 'main', 'index.cjs'), 'exports.register = () => {}') }
    return dir
  }
  const withShell = setShell(emptyIndex(), '1.2.5', 1)

  it('lists a packed app with what an installed copy needs to check it', () => {
    const ipc = { preload: { git: { status: { invoke: 'git:status' } } } }
    const { index, entry, data } = addApp(withShell, 'git', { dir: built('git', '1.0.1', { main: true, ipc }), version: '1.0.1' })
    expect(index.shell).toEqual({ version: '1.2.5', shellApi: 1 })
    expect(index.apps.git).toBe(entry)
    expect(entry).toMatchObject({ version: '1.0.1', requires: { shellApi: 1 }, file: 'git-1.0.1.nxapp', size: data.length, ipc })
    expect(entry.sha256).toBe(appPackage.sha256(data))
    expect(entry.mainSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(addApp(withShell, 'notes', { dir: built('notes', '1.0.0') }).entry.mainSha256).toBeNull()
  })

  it('refuses a release whose tag is not the app\'s version, or that is not newer', () => {
    expect(() => addApp(withShell, 'git', { dir: built('git', '1.0.1'), version: '1.0.2' })).toThrow(/1\.0\.1.*1\.0\.2/)
    const { index } = addApp(withShell, 'git', { dir: built('git', '1.0.1') })
    expect(() => addApp(index, 'git', { dir: built('git', '1.0.1') })).toThrow(/not newer/)
  })

  it('refuses an app no published NexusMD could run', () => {
    expect(() => addApp(emptyIndex(), 'git', { dir: built('git', '1.0.1') })).toThrow(/publish one/)
    expect(() => addApp(withShell, 'git', { dir: built('git', '2.0.0', { shellApi: 2 }) })).toThrow(/release NexusMD first/)
    expect(addApp(setShell(withShell, '1.3.0', 2), 'git', { dir: built('git', '2.0.0', { shellApi: 2 }) }).entry.version).toBe('2.0.0')
  })

  it('keeps a NexusMD release from dropping the apps already listed', () => {
    const { index } = addApp(withShell, 'git', { dir: built('git', '1.0.1') })
    expect(setShell(index, '1.2.6').apps.git.version).toBe('1.0.1')
  })

  it('names only this app\'s packages other than those kept', () => {
    const assets = ['apps-index.json', 'git-1.0.0.nxapp', 'git-1.0.1.nxapp', 'git-1.0.2.nxapp', 'gitx-1.0.0.nxapp', 'notes-1.0.0.nxapp']
    expect(obsoleteAssets(assets, 'git', ['git-1.0.2.nxapp', 'git-1.0.1.nxapp'])).toEqual(['git-1.0.0.nxapp'])
  })
})

// The release workflow's "Record this release in the app index" job runs this script with plain node and no `npm ci`,
// so nothing under @nexusmd/* can be resolved there. It broke the v1.2.36 index step when the registry began to
// require @nexusmd/main-kit/logging at load.
describe('the release script on a machine with nothing installed', () => {
  it('loads without resolving any @nexusmd/* workspace package', async () => {
    const { execFileSync } = await import('node:child_process')
    const script = `
      const M = require('module'); const resolve = M._resolveFilename;
      M._resolveFilename = function (request, ...rest) { if (request.startsWith('@nexusmd/')) throw new Error('not installed: ' + request); return resolve.call(this, request, ...rest) };
      const registry = require(${JSON.stringify(path.resolve(import.meta.dirname, '../electron/app-registry.cjs'))});
      if (typeof registry.SHELL_API === 'undefined' && !Object.keys(registry).length) throw new Error('empty');
    `
    expect(() => execFileSync(process.execPath, ['-e', script], { stdio: 'pipe' })).not.toThrow()
  })
})
