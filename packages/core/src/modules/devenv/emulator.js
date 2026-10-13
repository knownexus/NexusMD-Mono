// packages/core/src/modules/devenv/emulator.js
//
// The Emulator tab's model: devenv's AVD list and the argv for each emulator action, with
// devenv's own rules (AVD names, push destinations under /sdcard or /storage).

const AVD = /^[A-Za-z0-9_.-]+$/
const str = v => (typeof v === 'string' && v ? v : null)

export function normaliseAvds(result) {
  if (!result || result.kind !== 'emulator-avds') throw new Error('Not a devenv emulator-avds result')
  const avds = (Array.isArray(result.avds) ? result.avds : []).filter(n => typeof n === 'string' && AVD.test(n))
  return { avds, default: str(result.default), error: str(result.error) }
}

function avdName(avd) {
  if (typeof avd !== 'string' || !AVD.test(avd)) throw new Error(`Not an AVD name: ${avd}`)
  return avd
}

export function buildEmulatorArgv(action) {
  const a = action || {}
  switch (a.kind) {
    case 'start': return ['emulator', 'start', ...(a.avd ? ['--avd', avdName(a.avd)] : []), ...(a.proxy === false ? ['--no-proxy'] : [])]
    case 'stop': return ['emulator', 'stop']
    case 'proxy': return ['emulator', 'proxy', ...(a.on ? [] : ['--off'])]
    case 'push-ca': return ['emulator', 'push-ca']
    case 'push': {
      const paths = Array.isArray(a.paths) ? a.paths : []
      if (!paths.length) throw new Error('Choose at least one file to push.')
      for (const p of paths) if (typeof p !== 'string' || !p || p.startsWith('-')) throw new Error(`Not a file path: ${p}`)
      const dest = typeof a.dest === 'string' ? a.dest.trim() : ''
      if (dest && !/^\/(sdcard|storage)\//.test(dest)) throw new Error('The destination must start with /sdcard/ or /storage/.')
      return ['emulator', 'push', ...paths, ...(dest ? ['--to', dest] : [])]
    }
    case 'create': return ['emulator', 'create', '--avd', avdName(a.avd)]
    default: throw new Error(`Unknown emulator action: ${a.kind}`)
  }
}
