import { buildRequest } from './request-builder.js'

function normalizeHeaders(headers) {
  if (headers && typeof headers.entries === 'function') return Object.fromEntries(headers.entries())
  return headers || {}
}

/**
 * Builds (resolving vars/auth + pre-request script), sends via
 * adapters.apiHttp, times it, then runs the post-response script/tests via
 * adapters.scriptRunner. The returned `status` distinguishes a script failure
 * from a network failure from a request that sent fine but failed its tests,
 * so callers can render each case distinctly.
 */
export async function executeRequest(requestDef, { vars = {}, adapters = {} } = {}) {
  const { request, vars: builtVars, preScriptError, preScriptLogs } = await buildRequest(requestDef, { vars, adapters })

  if (preScriptError) {
    return { status: 'script-error', phase: 'pre-request', error: preScriptError, logs: preScriptLogs, vars: builtVars }
  }

  const started = Date.now()
  let response
  try {
    const raw = await adapters.apiHttp.fetch(request.url, {
      method:  request.method,
      headers: request.headers,
      body:    request.body,
    })
    const bodyText = typeof raw.text === 'function' ? await raw.text() : (raw.body ?? '')
    response = {
      status:     raw.status,
      statusText: raw.statusText,
      headers:    normalizeHeaders(raw.headers),
      body:       bodyText,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    return { status: 'network-error', phase: 'send', error: error?.message || String(error), vars: builtVars }
  }

  let tests = []
  let vars_ = builtVars
  let logs = preScriptLogs
  let postScriptError = null

  const postScript = [requestDef.postResponseScript, requestDef.tests].filter(Boolean).join('\n')
  if (postScript && adapters.scriptRunner) {
    const outcome = await adapters.scriptRunner.run(postScript, { vars: { ...builtVars }, request, response, tests: [] })
    logs = [...preScriptLogs, ...(outcome?.logs || [])]
    if (outcome?.error) {
      postScriptError = outcome.error
    } else {
      vars_ = outcome?.context?.vars ?? builtVars
      tests = outcome?.context?.tests ?? []
    }
  }

  if (postScriptError) {
    return { status: 'script-error', phase: 'post-response', error: postScriptError, response, logs, vars: vars_ }
  }

  const failedTests = tests.filter(t => !t.passed)
  return { status: failedTests.length ? 'failed' : 'passed', response, tests, logs, vars: vars_ }
}
