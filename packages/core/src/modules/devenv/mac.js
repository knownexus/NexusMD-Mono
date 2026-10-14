// packages/core/src/modules/devenv/mac.js
//
// The Mac tab's model: devenv's view of mac.json and whether it can log in, and the argv for
// each Mac action.

const CONNECTIONS = ['ok', 'auth', 'hostkey', 'unreachable', 'error', 'unconfigured']
const str = v => (typeof v === 'string' && v ? v : null)

export function normaliseMacStatus(result) {
  if (!result || result.kind !== 'mac-status') throw new Error('Not a devenv mac-status result')
  const configured = result.configured === true
  // An unconfigured Mac can't have a meaningful connection state, whatever devenv reported.
  const connection = !configured ? 'unconfigured' : CONNECTIONS.includes(result.connection) ? result.connection : 'error'
  return {
    configured, host: str(result.host), user: str(result.user), sshKey: str(result.sshKey),
    keyExists: result.keyExists === true, connection, detail: str(result.detail), error: str(result.error),
  }
}

const ACTIONS = {
  doctor: ['mac', 'doctor'], fix: ['mac', 'fix'], 'key-setup': ['mac', 'key-setup'],
  'ios-sim': ['setup', 'ios-sim'], 'ios-sim-remove': ['setup', 'ios-sim', '--remove'],
}

export function buildMacArgv(action) {
  if (!Object.hasOwn(ACTIONS, action)) throw new Error(`Unknown Mac action: ${action}`)
  return [...ACTIONS[action]]
}

const TEXT = {
  ok: 'devenv logs in to the Mac with its key.',
  auth: "The Mac doesn't accept this PC's key yet - set up the SSH key.",
  hostkey: "The Mac's host key has changed - if you trust this Mac, run ssh-keygen -R <its address> on this PC, then refresh.",
  unreachable: "Can't reach the Mac - is it on, on this network, with Remote Login enabled?",
  error: 'ssh failed - see the detail below.',
  unconfigured: 'mac.json is missing or invalid.',
}

export function macConnectionText(connection) {
  return TEXT[connection] ?? TEXT.error
}
