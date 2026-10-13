// packages/core/src/modules/devenv/logs.js
//
// The Logs tab's model: devenv's own list of logs (each with the argv that shows it), level
// highlighting and a plain-text filter over the lines a run produced.

import { stripAnsi } from './ansi.js'

export const CAPTURE_SINCE = ['15m', '30m', '1h', '2h', '6h', '24h']

const GROUPS = [
  { id: 'build', label: 'Build logs' },
  { id: 'emulator', label: 'Emulator' },
  { id: 'backend', label: 'Backend containers' },
  { id: 'test', label: 'Test stack' },
]

export function normaliseLogTargets(result) {
  if (!result || result.kind !== 'log-targets') throw new Error('Not a devenv log-targets result')
  const targets = (Array.isArray(result.targets) ? result.targets : [])
    .filter(t => t && typeof t === 'object' && GROUPS.some(g => g.id === t.group)
      && Array.isArray(t.argv) && t.argv.length && t.argv.every(a => typeof a === 'string'))
    .map(t => ({ id: `${t.group}:${t.key}`, group: t.group, key: String(t.key ?? ''), label: String(t.label ?? t.key ?? ''), argv: [...t.argv], follow: t.follow === true }))
  return {
    groups: GROUPS.map(g => ({ ...g, targets: targets.filter(t => t.group === g.id) })).filter(g => g.targets.length),
  }
}

// ASP.NET console ("fail:", "crit:", "warn:"), Serilog ("[ERR]", "[WRN]") and plain words.
const ERROR = /\b(fail|failed|error|err|crit|critical|fatal|exception|panic)\b/i
const WARN = /\b(warn|warning|wrn)\b/i

export function classifyLogLevel(text) {
  const t = stripAnsi(text ?? '')
  // MSBuild's success summary ("0 Error(s)") names the words but reports none.
  if (/^\s*0 (Warning|Error)\(s\)\s*$/i.test(t)) return null
  if (ERROR.test(t)) return 'error'
  if (WARN.test(t)) return 'warn'
  return null
}

export function filterLogLines(lines, query) {
  const q = (query ?? '').trim().toLowerCase()
  const all = lines.map((line, index) => ({ line, index }))
  if (!q) return all
  return all.filter(({ line }) => stripAnsi(line.text ?? '').toLowerCase().includes(q))
}

export function captureFolder(results) {
  const r = [...(results || [])].reverse().find(m => m?.kind === 'capture' && typeof m.path === 'string' && m.path)
  return r ? r.path : null
}
