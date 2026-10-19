import React from 'react'
import { toLf, fromLf, parseConflicts, resolveRegion, hasMarkers } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'
import { majorityEol, conflictDraftKey, getWorktreeDraft, putWorktreeDraft, dropWorktreeDraft } from './use-worktree-file.js'

const EMPTY = { status: 'idle', data: null, text: '', saved: '', eol: '\n', bom: false, workingStamp: null, draftStamp: null, current: 0, error: null, conflict: false, saving: false, restored: false }

// One conflicted file being resolved. The result text is held LF-only and starts as the working file
// (markers and all); line ending and BOM are remembered and put back on write. Unsaved result text
// lives in the worktree draft store so it survives the hook going away; it is checked against the
// working file's stamp when restored. Nothing is resolved silently: markResolved refuses while
// markers remain unless forced.
export function useConflict({ adapter, repo, worktreePath, registered, path }) {
  const [s, setS] = React.useState(path == null ? EMPTY : { ...EMPTY, status: 'loading' })
  const latest = React.useRef(s)
  latest.current = s
  const gen = React.useRef(0)
  const deps = React.useRef({ adapter, repo, worktreePath, registered })
  deps.current = { adapter, repo, worktreePath, registered }
  // Set synchronously so two clicks in the same tick can't both pass the guard.
  const busy = React.useRef(false)
  const repoPath = repo?.path
  const key = path == null ? null : conflictDraftKey(repoPath, worktreePath, path)

  const load = React.useCallback(async ({ discardDraft = false } = {}) => {
    const mine = ++gen.current
    busy.current = false
    if (path == null) { setS(EMPTY); return }
    setS({ ...EMPTY, status: 'loading' })
    if (discardDraft) dropWorktreeDraft(key)
    const d = deps.current
    try {
      const data = await d.adapter.conflict(d.repo, d.worktreePath, d.registered, path)
      if (gen.current !== mine) return
      const w = data.working
      const original = w ? w.text : ''
      const text = toLf(original)
      const base = { ...EMPTY, status: 'ready', data, saved: text, text, eol: majorityEol(original), bom: !!w?.bom, workingStamp: w?.stamp ?? null, draftStamp: w?.stamp ?? null }
      const draft = getWorktreeDraft(key)
      if (draft) {
        setS({ ...base, text: draft.text, eol: draft.eol, bom: draft.bom, restored: true, draftStamp: draft.stamp, conflict: draft.stamp !== base.workingStamp })
      } else setS(base)
    } catch (e) {
      if (gen.current === mine) setS({ ...EMPTY, status: 'error', error: ipcMessage(e) || 'Could not read the conflict.' })
    }
  }, [path, key])

  React.useEffect(() => { load() }, [load])

  const setText = React.useCallback(text => {
    const p = latest.current
    if (p.status !== 'ready') return
    if (key != null) {
      if (text !== p.saved) putWorktreeDraft(key, { text, saved: p.saved, eol: p.eol, bom: p.bom, stamp: p.draftStamp })
      else dropWorktreeDraft(key)
    }
    latest.current = { ...p, text }
    setS(q => ({ ...q, text }))
  }, [key])

  const regions = React.useMemo(() => (s.status === 'ready' || s.status === 'resolved' ? parseConflicts(s.text) : []), [s.status, s.text])

  // The two ways out of a flagged draft: take the disk version, or keep the draft over it.
  const reload = React.useCallback(({ discardDraft = false } = {}) => load({ discardDraft }), [load])
  const keepMine = React.useCallback(() => {
    const p = latest.current
    if (p.status !== 'ready') return
    const kept = getWorktreeDraft(key)
    if (kept) putWorktreeDraft(key, { ...kept, stamp: p.workingStamp })
    setS(q => ({ ...q, conflict: false, draftStamp: q.workingStamp }))
  }, [key])
  const setCurrent = React.useCallback(i => setS(q => ({ ...q, current: i })), [])

  const take = React.useCallback((index, choice) => {
    setText(resolveRegion(latest.current.text, index, choice))
  }, [setText])

  // Runs one guarded action; its result ({ ok } | { ok:false, stale } | { ok:false, detail }) is
  // mapped to 'ok' | 'stale' | false, anything but an explicit ok being a failure.
  const run = async (act, failure, { allowResolved = false } = {}) => {
    const st = latest.current.status
    if ((st !== 'ready' && !(allowResolved && st === 'resolved')) || busy.current) return false
    if (st === 'ready' && latest.current.conflict && !allowResolved) return 'conflict'
    busy.current = true
    const mine = gen.current
    setS(q => ({ ...q, saving: true, error: null }))
    let outcome = false
    let patch = null
    try {
      const r = await act(deps.current)
      if (r?.ok === true) { dropWorktreeDraft(key); outcome = 'ok'; patch = allowResolved ? { restored: false, conflict: false } : { status: 'resolved', restored: false, conflict: false }; if (patch.status && gen.current === mine) latest.current = { ...latest.current, status: 'resolved' } }
      else if (r?.stale) { outcome = 'stale'; patch = { conflict: true } }
      else patch = { error: r?.detail || failure }
    } catch (e) {
      patch = { error: ipcMessage(e) || failure }
    }
    if (gen.current !== mine) return outcome
    busy.current = false
    setS(q => ({ ...q, saving: false, ...patch }))
    return outcome
  }

  const markResolved = React.useCallback(({ force = false } = {}) => {
    const p = latest.current
    if (p.status !== 'ready') return Promise.resolve(false)
    if (p.conflict) return Promise.resolve('conflict')
    if (!force && hasMarkers(p.text)) return Promise.resolve('markers')
    return run(d => d.adapter.resolveConflict(d.repo, d.worktreePath, d.registered, path,
      { take: 'text', text: fromLf(p.text, p.eol), bom: p.bom, force }, p.data.stamp), 'Could not mark the file resolved.')
  // run reads everything else through refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key])

  const takeWhole = React.useCallback(choice => {
    const p = latest.current
    if (p.status !== 'ready') return Promise.resolve(false)
    return run(d => d.adapter.resolveConflict(d.repo, d.worktreePath, d.registered, path, { take: choice }, p.data.stamp), 'Could not resolve the file.')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key])

  const unresolve = React.useCallback(async () => {
    const out = await run(async d => {
      const expected = await d.adapter.stamp(d.repo, d.worktreePath, d.registered, { kind: 'files', paths: [path] })
      return d.adapter.unresolve(d.repo, d.worktreePath, d.registered, path, expected)
    }, 'Could not unresolve the file.', { allowResolved: true })
    if (out === 'ok') load()
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, load])

  return { status: s.status, data: s.data, text: s.text, setText, regions, current: s.current, setCurrent, take, markResolved, takeWhole, unresolve, reload, keepMine, error: s.error, saving: s.saving, conflict: s.conflict, restored: s.restored }
}
