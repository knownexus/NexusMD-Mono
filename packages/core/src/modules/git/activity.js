// packages/core/src/modules/git/activity.js
//
// The session's activity log: one entry per target per run, newest first.

export const ACTIVITY_MAX = 200

/** @param {{ runId: string, at: number, kind: string, targetId: string, label: string, ok: boolean, summary: string, detail?: string }} entry */
export function addActivity(log, entry) {
  return [entry, ...log].slice(0, ACTIVITY_MAX)
}

export function failedTargets(log, runId) {
  return [...new Set(log.filter(e => e.runId === runId && !e.ok).map(e => e.targetId))]
}
