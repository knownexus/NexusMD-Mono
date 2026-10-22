import React from 'react'
import { previewModel, addActivity, failedTargets } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'

const CONCURRENCY = 2

// At most `limit` promises at once, results in input order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const repoOf = t => ({ name: t.repo, path: t.repoRoot })

/**
 * Stage 4 actions: preview every target, let the user confirm, run the eligible ones (one at a time
 * per repository, two repositories at once), log each result, then reload the snapshot once.
 * Retry re-previews only a run's failures; it never re-runs with an old stamp.
 */
export function useGitSync({ adapter, registered, reload }) {
  const [dialog, setDialog] = React.useState(null)
  const [activity, setActivity] = React.useState([])
  const runs = React.useRef(0)
  // Every run's kind, targets and options, so Retry failed works after its dialog has closed.
  const runInfo = React.useRef(new Map())
  const seq = React.useRef(0)

  const preview = React.useCallback(async (kind, targets, options) => {
    const id = ++seq.current
    const previews = await mapLimit(targets, CONCURRENCY, async target => {
      if (target.unavailable) return { target }
      try {
        return { target, preview: await adapter.preview(repoOf(target), target.worktreePath, registered, kind, options) }
      } catch (e) {
        return { target, error: ipcMessage(e) }
      }
    })
    if (id !== seq.current) return
    setDialog(d => (d && d.kind === kind ? { ...d, options, model: previewModel(kind, previews), loading: false } : d))
  }, [adapter, registered])

  // `choices`: other targets the dialog may switch to (Cherry-pick's "Onto branch").
  const open = React.useCallback((kind, targets, options = {}, { choices = null } = {}) => {
    const runId = String(++runs.current)
    runInfo.current.set(runId, { kind, targets, options })
    setDialog({ runId, kind, targets, options, choices, model: null, loading: true, results: null, running: false })
    preview(kind, targets, options)
  }, [preview])

  // Runs the same action on a different one of the dialog's choices; previews again.
  const retarget = React.useCallback(target => {
    if (!dialog || dialog.running || !target) return
    runInfo.current.set(dialog.runId, { kind: dialog.kind, targets: [target], options: dialog.options })
    setDialog({ ...dialog, targets: [target], loading: true, results: null })
    preview(dialog.kind, [target], dialog.options)
  }, [dialog, preview])

  const setOptions = React.useCallback(options => {
    if (!dialog || dialog.running) return
    runInfo.current.set(dialog.runId, { kind: dialog.kind, targets: dialog.targets, options })
    setDialog({ ...dialog, options, loading: true, results: null })
    preview(dialog.kind, dialog.targets, options)
  }, [dialog, preview])

  const close = React.useCallback(() => setDialog(d => (d?.running ? d : null)), [])

  const confirm = React.useCallback(async () => {
    const d = dialog
    if (!d || d.running || !d.model) return
    const rows = d.model.rows.filter(r => r.eligible && d.targets.find(t => t.id === r.id)?.ticked !== false)
    if (!rows.length) return
    setDialog({ ...d, running: true })
    const byRepo = new Map()
    for (const row of rows) {
      const target = d.targets.find(t => t.id === row.id)
      byRepo.set(target.repoRoot, [...(byRepo.get(target.repoRoot) ?? []), { row, target }])
    }
    const results = {}
    await mapLimit([...byRepo.values()], CONCURRENCY, async group => {
      for (const { row, target } of group) {
        let res
        try {
          res = await adapter.run(repoOf(target), target.worktreePath, registered, d.kind, d.options, row.stamp)
        } catch (e) {
          res = { ok: false, detail: ipcMessage(e) }
        }
        results[row.id] = res
        setActivity(log => addActivity(log, {
          runId: d.runId, at: Date.now(), kind: d.kind, targetId: row.id, label: row.label, ok: !!res.ok,
          summary: res.ok ? 'Done' : (res.detail || 'Failed').split('\n')[0], detail: res.detail ?? '',
        }))
      }
    })
    setDialog(cur => (cur && cur.runId === d.runId ? { ...cur, running: false, results } : cur))
    // Only the repos acted on have changed.
    reload?.([...new Set(d.targets.map(t => t.repo))])
  }, [dialog, adapter, registered, reload])

  const retryFailed = React.useCallback(runId => {
    const failed = failedTargets(activity, runId)
    const source = runInfo.current.get(runId)
    if (!failed.length || !source) return
    open(source.kind, source.targets.filter(t => failed.includes(t.id)), source.options)
  }, [activity, open])

  return { dialog, open, setOptions, retarget, close, confirm, activity, retryFailed }
}
