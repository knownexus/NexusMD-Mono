// packages/core/src/modules/devenv/builds.js
//
// `devenv build status --json` as the Builds tab's view model, and the argv for each build
// action. A newer devenv's unknown kinds are dropped rather than shown as APIs.

export const MOBILE_ABIS = ['x64', 'arm64', 'x86', 'arm', 'all']
export const DEPLOY_MODES = ['fast', 'full']
// Verbs in the build group that an API key must not shadow.
const RESERVED = ['apis', 'mobile', 'ios', 'status']

const str = v => (typeof v === 'string' && v ? v : null)
const commit = c => (c && typeof c === 'object' ? { commit: str(c.commit), dirty: c.dirty === true, at: str(c.at) } : null)

function item(i) {
  return {
    key: String(i.key ?? ''), label: String(i.label ?? i.key ?? ''), kind: i.kind,
    source: i.source && typeof i.source === 'object' ? { branch: str(i.source.branch), commit: str(i.source.commit), dirty: i.source.dirty === true } : null,
    built: commit(i.built),
    upToDate: i.upToDate === true,
    error: str(i.error),
    log: str(i.log),
    mode: i.mode && typeof i.mode === 'object' ? { deploy: str(i.mode.deploy), abi: str(i.mode.abi) } : null,
    ios: commit(i.ios),
  }
}

export function normaliseBuilds(result) {
  if (!result || result.kind !== 'builds') throw new Error('Not a devenv builds result')
  const items = (Array.isArray(result.items) ? result.items : [])
    .filter(i => i && typeof i === 'object' && (i.kind === 'api' || i.kind === 'mobile'))
    .map(item)
  return { at: str(result.at), apis: items.filter(i => i.kind === 'api'), mobile: items.find(i => i.kind === 'mobile') ?? null }
}

export function buildBuildArgv(action) {
  const a = action || {}
  switch (a.kind) {
    case 'api': {
      if (typeof a.key !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(a.key) || RESERVED.includes(a.key.toLowerCase())) throw new Error(`Not an API key: ${a.key}`)
      return ['build', a.key, ...(a.clean ? ['--clean'] : [])]
    }
    case 'apis': return ['build', 'apis', ...(a.clean ? ['--clean'] : [])]
    case 'mobile': {
      const abi = a.abi ?? 'x64'
      const deploy = a.deploy ?? 'fast'
      if (!MOBILE_ABIS.includes(abi)) throw new Error(`Unknown ABI: ${abi}`)
      if (!DEPLOY_MODES.includes(deploy)) throw new Error(`Unknown deploy mode: ${deploy}`)
      return ['build', 'mobile', '--abi', abi, '--deploy', deploy, ...(a.install ? ['--install'] : [])]
    }
    case 'ios': {
      const device = typeof a.device === 'string' ? a.device.trim() : ''
      // devenv reads anything starting with '-' as an option.
      if (device.startsWith('-')) throw new Error(`Not a device name: ${device}`)
      return ['build', 'ios', ...(device ? ['--device', device] : []), ...(a.noRun ? ['--no-run'] : [])]
    }
    case 'app-install': return ['app', 'install']
    default: throw new Error(`Unknown build action: ${a.kind}`)
  }
}
