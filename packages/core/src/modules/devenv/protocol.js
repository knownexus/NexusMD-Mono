// packages/core/src/modules/devenv/protocol.js
//
// devenv's host-mode protocol (C:\repos\dev-environment\host-common.ps1): any stdout line
// starting with CONTROL_PREFIX is one JSON control message; everything else is output.

export const CONTROL_PREFIX = '@@devenv '
export const PROTOCOL_VERSION = 1

/**
 * Classify one stdout line from devenv.
 * @param {string} line
 * @returns {{ type: string, [key: string]: any }} `{ type: 'output', text }` for ordinary
 *   output (and anything malformed), otherwise the parsed control message.
 */
export function parseLine(line) {
  if (typeof line !== 'string') return { type: 'output', text: '' }
  if (!line.startsWith(CONTROL_PREFIX)) return { type: 'output', text: line }
  try {
    const msg = JSON.parse(line.slice(CONTROL_PREFIX.length))
    if (msg && typeof msg.type === 'string') return msg
  } catch { /* malformed control lines are shown as output so nothing is silently lost */ }
  return { type: 'output', text: line }
}
