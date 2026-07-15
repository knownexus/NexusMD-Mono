import { executeRequest } from './executor.js'
import { flattenRequestRefs } from './collection-store.js'

/** Builds ordered { refId, name, requestDef } entries for every request under `nodes`. */
export function buildRunEntries(collection, nodes) {
  return flattenRequestRefs(nodes)
    .map(({ refId, name }) => ({ refId, name, requestDef: collection.requests?.[refId] }))
    .filter(e => e.requestDef)
}

/**
 * Runs each entry's request in order, carrying forward vars a request's
 * scripts update so later requests in the run can use them (e.g. a login
 * request setting an auth token for the rest of the collection).
 * Stops after the first non-'passed' result when stopOnFailure is true.
 */
export async function runCollection(entries, { vars = {}, adapters = {}, stopOnFailure = false } = {}) {
  const results = []
  let currentVars = vars
  let passed = 0
  let failed = 0
  const startedAt = Date.now()

  for (const entry of entries) {
    const result = await executeRequest(entry.requestDef, { vars: currentVars, adapters })
    currentVars = result.vars ?? currentVars

    const ok = result.status === 'passed'
    if (ok) passed++
    else failed++

    results.push({ refId: entry.refId, name: entry.name, ...result })
    if (!ok && stopOnFailure) break
  }

  return { results, totalDurationMs: Date.now() - startedAt, passed, failed }
}
