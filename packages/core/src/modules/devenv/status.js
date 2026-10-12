// packages/core/src/modules/devenv/status.js
//
// `devenv status --json` as the Status tab's view model. Unknown states read as 'missing'
// so a newer devenv can't make a card claim something is running.

const STATES = ['running', 'stopped', 'missing']
const state = v => (STATES.includes(v) ? v : 'missing')
const str = v => (typeof v === 'string' && v ? v : null)
const items = list => (Array.isArray(list) ? list : []).map(i => ({
  key: String(i?.key ?? ''), label: String(i?.label ?? i?.key ?? ''), port: Number.isFinite(i?.port) ? i.port : null, state: state(i?.state),
}))

export function normaliseStatus(result) {
  if (!result || result.kind !== 'status') throw new Error('Not a devenv status')
  const emu = result.android?.emulator
  return {
    at: str(result.at),
    docker: { ok: result.docker?.ok === true, error: str(result.docker?.error) },
    backend: items(result.backend),
    infra: (Array.isArray(result.infra) ? result.infra : []).map(i => ({ service: String(i?.service ?? ''), state: state(i?.state) })),
    database: { state: state(result.database?.state), ui: state(result.database?.ui), baseline: str(result.database?.baseline) },
    test: { tracer: state(result.test?.tracer), apis: items(result.test?.apis) },
    android: {
      emulator: emu && typeof emu === 'object' ? { running: emu.running === true, serial: str(emu.serial), avd: str(emu.avd) } : null,
      proxy: state(result.android?.proxy),
    },
    ios: { host: str(result.ios?.host), error: str(result.ios?.error) },
  }
}
