// Runs a request imported from Bruno with its scripts (scriptFlavor 'bruno').
// It differs from the plain executor in the ways Bruno scripts rely on:
//   - env vars and runtime vars are kept apart (bru.getEnvVar vs bru.getVar);
//     {{vars}} resolve from both, runtime winning, and the runtime vars a run
//     ends with are returned so the caller can keep them for the next send.
//   - the pre-request script runs BEFORE {{vars}} are resolved, so a token it
//     fetches (bru.runRequest) or sets is used by the request it ran for.
//   - scripts may await bru.runRequest(path); the sandbox pauses and this file
//     sends that request (looked up by its Bruno path) and resumes the script.
//   - bru.runner.skipRequest() ends the run as 'skipped' without sending.
// The scripts run via adapters.scriptRunner.runBruno/resumeBruno.

import { buildRequest } from './request-builder.js'
import { sendRequest } from './http-send.js'

const MAX_RUN_REQUEST_DEPTH = 3

/** Normalises a Bruno request path ("./00-setup/Authenticate.bru") for lookup. */
export function normalizeBrunoPath(path) {
  const p = String(path).replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase()
  return p.endsWith('.bru') ? p : `${p}.bru`
}

/** Maps a loaded collection's Bruno paths to their request definitions, for bru.runRequest. */
export function brunoRequestLookup(collection) {
  const byPath = new Map()
  for (const def of Object.values(collection?.requests || {})) {
    if (def?.brunoPath) byPath.set(normalizeBrunoPath(def.brunoPath), def)
  }
  return (path) => byPath.get(normalizeBrunoPath(path))
}

// Runs one script phase to completion, sending any bru.runRequest it awaits.
async function runPhase(adapters, script, input, onRunRequest) {
  let outcome = await adapters.scriptRunner.runBruno(script, input)
  while (outcome && !outcome.done) {
    const { sessionId, pending } = outcome
    for (const p of pending) {
      const result = await onRunRequest(p.path, outcome.context?.vars ?? input.vars)
      outcome = await adapters.scriptRunner.resumeBruno(sessionId, p.id, result)
      if (outcome?.done) break
    }
  }
  return outcome || { done: true, context: null, logs: [], error: 'The script runner returned nothing.' }
}

export async function executeBrunoRequest(requestDef, options = {}) {
  const { env = {}, envName, adapters = {}, lookupRequest, depth = 0 } = options
  let runtime = { ...(options.runtimeVars || {}) }
  let logs = []
  const tests = []
  const result = (fields) => ({ tests, logs, ...fields, runtimeVars: runtime, vars: { ...env, ...runtime } })

  const onRunRequest = async (path, vars) => {
    if (depth >= MAX_RUN_REQUEST_DEPTH) return { vars, error: `bru.runRequest("${path}") is nested too deeply` }
    const target = lookupRequest?.(path)
    if (!target) return { vars, error: `bru.runRequest: there is no request at "${path}" in this collection` }
    const nested = await executeBrunoRequest(target, { ...options, runtimeVars: vars, depth: depth + 1 })
    if (nested.status === 'network-error' || nested.status === 'script-error') return { vars: nested.runtimeVars, error: nested.error }
    return { vars: nested.runtimeVars, response: nested.response }
  }

  const phase = async (name, script, extra) => {
    const out = await runPhase(adapters, script, { phase: name, env, envName, vars: runtime, ...extra }, onRunRequest)
    logs = [...logs, ...(out.logs || [])]
    if (out.context?.vars) runtime = out.context.vars
    if (out.context?.tests) tests.push(...out.context.tests)
    return out
  }

  // ── pre-request: sees and may edit the request before {{vars}} resolve ──
  let def = requestDef
  if (requestDef.preRequestScript) {
    const raw = { name: requestDef.name, method: requestDef.method, url: requestDef.url, headers: { ...(requestDef.headers || {}) }, body: requestDef.body }
    const out = await phase('pre-request', requestDef.preRequestScript, { request: raw })
    if (out.error) return result({ status: 'script-error', phase: 'pre-request', error: out.error })
    if (out.context?.skipped) return result({ status: 'skipped' })
    const edited = out.context?.request || raw
    def = { ...requestDef, method: edited.method, url: edited.url, headers: edited.headers, body: edited.body }
  }

  // ── send ──
  // No scriptRunner here: the Bruno script already ran, and buildRequest
  // would otherwise run it again as a plain script.
  const { request } = await buildRequest(def, { vars: { ...env, ...runtime }, adapters: {} })
  const sent = await sendRequest(adapters, request)
  if (sent.error) return result({ status: 'network-error', phase: 'send', error: sent.error })
  const { response } = sent

  // ── post-response, then tests (tests still run if the script failed) ──
  let postError = null
  if (requestDef.postResponseScript) {
    const out = await phase('post-response', requestDef.postResponseScript, { request, response })
    postError = out.error
  }
  let testsError = null
  if (requestDef.tests) {
    const out = await phase('tests', requestDef.tests, { request, response })
    testsError = out.error
  }

  if (postError) return result({ status: 'script-error', phase: 'post-response', error: postError, response })
  if (testsError) return result({ status: 'script-error', phase: 'tests', error: testsError, response })
  return result({ status: tests.some(t => !t.passed) ? 'failed' : 'passed', response })
}
