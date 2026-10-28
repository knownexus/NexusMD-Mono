import { buildRequest } from './request-builder.js'
import { sendRequest } from './http-send.js'
import { executeBrunoRequest } from './bruno-executor.js'

/**
 * Builds (resolving vars/auth + pre-request script), sends via
 * adapters.apiHttp, times it, then runs the post-response script/tests via
 * adapters.scriptRunner. The returned `status` distinguishes a script failure
 * from a network failure from a request that sent fine but failed its tests,
 * so callers can render each case distinctly.
 *
 * A request imported from Bruno with its scripts (scriptFlavor 'bruno') runs
 * through bruno-executor.js instead, which takes env and runtime vars apart
 * (`env`, `runtimeVars`) and can resolve bru.runRequest via `lookupRequest`.
 */
export async function executeRequest(requestDef, options = {}) {
  const { vars = {}, adapters = {} } = options
  if (requestDef?.scriptFlavor === 'bruno') {
    return executeBrunoRequest(requestDef, {
      env:           options.env ?? vars,
      runtimeVars:   options.runtimeVars ?? {},
      envName:       options.envName,
      adapters,
      lookupRequest: options.lookupRequest,
    })
  }

  const { request, vars: builtVars, preScriptError, preScriptLogs } = await buildRequest(requestDef, { vars, adapters })

  if (preScriptError) {
    return { status: 'script-error', phase: 'pre-request', error: preScriptError, logs: preScriptLogs, vars: builtVars }
  }

  const sent = await sendRequest(adapters, request)
  if (sent.error) {
    return { status: 'network-error', phase: 'send', error: sent.error, vars: builtVars }
  }
  const { response } = sent

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
