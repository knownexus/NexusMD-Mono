// Publishes app updates: packs a built app folder (build-split.mjs) and lists it in apps-index.json,
// signed, for installed copies of NexusMD to download (electron/app-updater.cjs). The workflows
// (release-apps.yml, release-desktop.yml) fetch the current index from the apps-latest release, run
// this, and upload what it writes.
//
//   node build/app-release.mjs app <id> --version <x.y.z> --index <apps-index.json> --assets <names.txt> --out <dir>
//       packs dist/desktop/split/apps/<id> as <id>-<version>.nxapp, lists it, and names the
//       release's older packages of that app that can go (obsolete.txt)
//   node build/app-release.mjs shell --version <x.y.z> [--index <apps-index.json>] --out <dir>
//       records a published NexusMD release and the shell API it gives apps
//
// Both write apps-index.json and apps-index.json.sig, signed with NEXUSMD_APPS_SIGNING_KEY (a PEM).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import appPackage from '../electron/app-package.cjs'
import shellApiModule from '../electron/shell-api.cjs'
import registry from '../electron/app-registry.cjs'

const { packApp, sha256, signIndex } = appPackage
const { SHELL_API } = shellApiModule
const { compareVersions } = registry

const here = dirname(fileURLToPath(import.meta.url))
const builtApps = resolve(here, '..', '..', '..', 'dist', 'desktop', 'split', 'apps')

export const emptyIndex = () => ({ schema: 1, shell: null, apps: {} })

export function setShell(index, version, shellApi = SHELL_API) {
  return { ...index, shell: { version, shellApi } }
}

// Packs one built app and lists it. Refuses a version that isn't newer than the one listed, and an app
// that needs a shell API no published NexusMD gives, since nobody could run it.
export function addApp(index, id, { dir = join(builtApps, id), version } = {}) {
  const manifest = JSON.parse(readFileSync(join(dir, 'app.manifest.json'), 'utf8'))
  if (manifest.id !== id) throw new Error(`${dir} holds app "${manifest.id}", not "${id}"`)
  if (version && manifest.version !== version) {
    throw new Error(`${id} is version ${manifest.version} in its package.json, but the release is for ${version}`)
  }
  const listed = index.apps[id]
  if (listed && compareVersions(manifest.version, listed.version) <= 0) {
    throw new Error(`${id} ${manifest.version} is not newer than the ${listed.version} already published; raise its version`)
  }
  const needs = manifest.requires?.shellApi ?? 1
  if (!index.shell) throw new Error('no NexusMD release is recorded in the index yet; publish one (a v* tag) first')
  if (needs > index.shell.shellApi) {
    throw new Error(`${id} ${manifest.version} needs shell API ${needs}, but the newest NexusMD (${index.shell.version}) gives ${index.shell.shellApi}; release NexusMD first`)
  }
  const data = packApp(dir)
  const mainFile = join(dir, 'main', 'index.cjs')
  const entry = {
    version: manifest.version,
    requires: { shellApi: needs },
    file: `${id}-${manifest.version}.nxapp`,
    size: data.length,
    sha256: sha256(data),
    // For telling an update that only changes the app's screens from one that changes its main process.
    mainSha256: existsSync(mainFile) ? sha256(readFileSync(mainFile)) : null,
    ipc: manifest.ipc ?? null,
  }
  return { index: { ...index, apps: { ...index.apps, [id]: entry } }, entry, data, previous: listed ?? null }
}

// The release's packages of this app other than the new one and the one before it (kept so a copy
// mid-download of that one still finds it).
export function obsoleteAssets(assetNames, id, keep) {
  const own = new RegExp(`^${id}-\\d+\\.\\d+\\.\\d+\\.nxapp$`)
  return assetNames.filter(name => own.test(name) && !keep.includes(name))
}

function writeSigned(out, index) {
  const key = process.env.NEXUSMD_APPS_SIGNING_KEY
  if (!key) throw new Error('NEXUSMD_APPS_SIGNING_KEY is not set')
  const bytes = JSON.stringify(index, null, 2) + '\n'
  writeFileSync(join(out, 'apps-index.json'), bytes)
  writeFileSync(join(out, 'apps-index.json.sig'), signIndex(bytes, key) + '\n')
}

function main(argv) {
  const [command, ...rest] = argv
  const option = name => { const at = rest.indexOf(`--${name}`); return at >= 0 ? rest[at + 1] : undefined }
  const out = option('out')
  if (!out) throw new Error('--out is required')
  mkdirSync(out, { recursive: true })
  const indexFile = option('index')
  const index = indexFile && existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : emptyIndex()

  if (command === 'shell') {
    const version = option('version')
    if (!version) throw new Error('--version is required')
    writeSigned(out, setShell(index, version))
    console.log(`apps-index.json records NexusMD ${version} (shell API ${SHELL_API})`)
  } else if (command === 'app') {
    const id = rest[0]
    if (!id || id.startsWith('--')) throw new Error('name the app: app-release.mjs app <id> ...')
    const added = addApp(index, id, { version: option('version') })
    writeFileSync(join(out, added.entry.file), added.data)
    writeSigned(out, added.index)
    const assetsFile = option('assets')
    const assets = assetsFile && existsSync(assetsFile) ? readFileSync(assetsFile, 'utf8').split(/\r?\n/).filter(Boolean) : []
    const obsolete = obsoleteAssets(assets, id, [added.entry.file, added.previous?.file].filter(Boolean))
    writeFileSync(join(out, 'obsolete.txt'), obsolete.map(n => n + '\n').join(''))
    console.log(`${added.entry.file}: ${(added.entry.size / 1024).toFixed(0)} KB${obsolete.length ? `; removing ${obsolete.join(', ')}` : ''}`)
  } else {
    throw new Error('usage: app-release.mjs app <id> ... | shell ...')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)) } catch (err) { console.error(err.message); process.exit(1) }
}
