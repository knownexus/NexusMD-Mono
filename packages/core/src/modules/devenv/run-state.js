// packages/core/src/modules/devenv/run-state.js
//
// State of one devenv run as the renderer sees it, built only from the events Electron
// forwards. Answers to prompts are never stored here (they may be passwords).

import { parseLine } from './protocol.js'

export const MAX_LINES = 5000

export function createRunState(command = '') {
  return {
    command, runId: null, status: 'idle', lines: [], prompts: [], step: null,
    results: [], opens: [], exitCode: null, error: null, cancelling: false,
  }
}

export function applyStarting(state) {
  return { ...createRunState(state.command), status: 'starting' }
}

export function applyStarted(state, runId) {
  return { ...state, runId, status: 'running' }
}

export function applyStartFailed(state, message) {
  return { ...state, status: 'failed', error: message }
}

/**
 * @param {'stdout'|'stderr'} stream
 * @param {string} line
 */
export function applyLine(state, stream, line) {
  const msg = stream === 'stdout' ? parseLine(line) : { type: 'output', text: line ?? '' }
  switch (msg.type) {
    case 'output': {
      const lines = [...state.lines, { stream, text: msg.text }]
      return { ...state, lines: lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines }
    }
    case 'prompt': return { ...state, prompts: [...state.prompts, msg] }
    case 'step':   return { ...state, step: { n: msg.n, total: msg.total, text: msg.text } }
    case 'result': return { ...state, results: [...state.results, msg] }
    case 'open':   return { ...state, opens: [...state.opens, msg] }
    default:       return state
  }
}

export function applyAnswered(state, promptId) {
  return { ...state, prompts: state.prompts.filter(p => p.id !== promptId) }
}

export function applyOpened(state) {
  return { ...state, opens: [] }
}

export function applyCancelRequested(state) {
  return { ...state, cancelling: true }
}

export function applyExit(state, code) {
  const status = state.cancelling ? 'cancelled' : code === 0 ? 'done' : 'failed'
  return { ...state, status, exitCode: code, prompts: [], cancelling: false }
}
