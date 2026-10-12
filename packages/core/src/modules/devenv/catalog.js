// packages/core/src/modules/devenv/catalog.js
//
// devenv's command table, as exported by `devenv help --json`, turned into what the
// Commands screen needs: a form per command and the argv that runs it.

import { PROTOCOL_VERSION } from './protocol.js'

const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v))
const strings = v => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])
const PATH_ARGS = ['file', 'folder', 'any']

export function commandKey(c) {
  return [c.group, c.verb].filter(Boolean).join(' ')
}

/**
 * @param {object} result  The `result` control message with kind 'catalog'.
 */
export function normaliseCatalog(result) {
  if (!result || result.kind !== 'catalog') throw new Error('Not a devenv catalog')
  const commands = (Array.isArray(result.commands) ? result.commands : []).map(c => {
    const cmd = {
      group: str(c.group), verb: str(c.verb), args: str(c.args), summary: str(c.summary),
      switches: strings(c.switches), values: strings(c.values),
      // Profile commands written before NexusMD existed have no Mut: assume they change state.
      mut: c.mut !== false,
      pathValues: c.pathValues && typeof c.pathValues === 'object' && !Array.isArray(c.pathValues) ? c.pathValues : {},
      pathArgs: PATH_ARGS.includes(c.pathArgs) ? c.pathArgs : null,
      hidden: c.hidden === true,
    }
    return { ...cmd, key: commandKey(cmd) }
  })
  const used = new Set(commands.map(c => c.group))
  const groups = []
  for (const g of Array.isArray(result.groups) ? result.groups : []) {
    const id = str(g.id)
    if (used.has(id) && !groups.some(x => x.id === id)) groups.push({ id, title: str(g.title) || id })
  }
  for (const id of used) if (!groups.some(x => x.id === id)) groups.push({ id, title: id || 'Everyday' })
  return { protocol: result.protocol, profileError: result.profileError || null, groups, commands }
}

export function isCompatibleCatalog(catalog) {
  return catalog?.protocol === PROTOCOL_VERSION
}

export function takesArgs(command) {
  return command.args.trim() !== ''
}

export function takesManyArgs(command) {
  return command.args.includes('...')
}

/**
 * The argv for devenv.ps1. Only switches/values the command declares are passed.
 * @param {object} command  A normalised catalog command.
 * @param {{ positional?: string[], switches?: Record<string, boolean>, values?: Record<string, string> }} [form]
 * @returns {string[]}
 */
export function buildDevenvArgv(command, { positional = [], switches = {}, values = {} } = {}) {
  const argv = command.group ? [command.group, command.verb] : [command.verb]
  for (const p of positional) {
    const v = str(p).trim()
    if (v) argv.push(v)
  }
  for (const s of command.switches) if (switches[s]) argv.push(`--${s}`)
  for (const name of command.values) {
    const v = str(values[name]).trim()
    if (v) argv.push(`--${name}`, v)
  }
  return argv
}
