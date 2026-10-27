// Builds the Windows release: the apps, the staged main process, the app list for the installer, then
// electron-builder for the installer and for the portable build.
//
//   node installer/build-win.mjs [--publish never|always] [nsis|portable ...]
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stage } from './stage.mjs'
import { writeAppsNsh } from './gen-apps-nsh.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const desktop = resolve(here, '..')

// Windows needs a shell to run npx (a .cmd), but not an executable given by its full path: through the
// shell, a path with a space (C:\Program Files\nodejs\node.exe) would be split at the space.
function run(command, args, env = {}) {
  const shell = process.platform === 'win32' && !isAbsolute(command)
  const result = spawnSync(command, args, { cwd: desktop, stdio: 'inherit', shell, env: { ...process.env, ...env } })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status})`)
}

const argv = process.argv.slice(2)
const publishAt = argv.indexOf('--publish')
const publish = publishAt >= 0 ? argv.splice(publishAt, 2)[1] : 'never'
const targets = argv.length ? argv : ['nsis', 'portable']

run(process.execPath, [join(desktop, 'build', 'build-split.mjs')])
stage()
writeAppsNsh()
for (const target of targets) {
  run('npx', ['electron-builder', '--win', '--config', 'electron-builder.win.cjs', '--publish', publish], { NEXUSMD_WIN_TARGET: target })
}
