import { executeRequest } from './executor.js'
import { flattenRequestRefs } from './collection-store.js'

/** Builds ordered { refId, name, requestDef } entries for every request under `nodes`. */
export function buildRunEntries(collection, nodes) {
  return flattenRequestRefs(nodes)
    .map(({ refId, name }) => ({ refId, name, requestDef: collection.requests?.[refId] }))
    .filter(e => e.requestDef)
}

/**
 * The runtime vars after a request ran with `merged` (env + runtime) vars. A
 * Bruno request reports its runtime vars directly; a plain script hands back
 * the whole var map, so only what it changed is kept (an env value copied into
 * the runtime vars would hide later edits to the environment).
 */
export function nextRuntimeVars(result, merged, runtime) {
  if (result?.runtimeVars) return result.runtimeVars
  const next = { ...runtime }
  for (const [k, v] of Object.entries(result?.vars ?? {})) if (merged[k] !== v) next[k] = v
  return next
}

/**
 * Runs each entry's request in order, carrying forward vars a request's
 * scripts update so later requests in the run can use them (e.g. a login
 * request setting an auth token for the rest of the collection).
 * Stops after the first failed result when stopOnFailure is true; a request a
 * Bruno script skipped (bru.runner.skipRequest) is counted as skipped, not failed.
 *
 * `env` is the environment's vars (`vars` is accepted for it too) and
 * `runtimeVars` what scripts have set so far; the run returns the runtime vars
 * it ends with so the caller can keep them.
 */
export async function runCollection(entries, options = {}) {
  const { adapters = {}, stopOnFailure = false, envName, lookupRequest } = options
  const env = options.env ?? options.vars ?? {}
  let runtime = { ...(options.runtimeVars || {}) }
  const results = []
  let passed = 0
  let failed = 0
  let skipped = 0
  const startedAt = Date.now()

  for (const entry of entries) {
    const merged = { ...env, ...runtime }
    const result = await executeRequest(entry.requestDef, { vars: merged, env, runtimeVars: runtime, envName, adapters, lookupRequest })

    runtime = nextRuntimeVars(result, merged, runtime)

    if (result.status === 'passed') passed++
    else if (result.status === 'skipped') skipped++
    else failed++

    results.push({ refId: entry.refId, name: entry.name, ...result })
    if (stopOnFailure && result.status !== 'passed' && result.status !== 'skipped') break
  }

  return { results, totalDurationMs: Date.now() - startedAt, passed, failed, skipped, runtimeVars: runtime }
}
