import React from 'react'
import { toLf, fromLf } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'

const EMPTY = { status: 'idle', text: '', saved: '', eol: '\n', bom: false, stamp: null, error: null, conflict: false, saving: false, restored: false }

// The line ending a file is written back with: whichever its lines mostly use (a tie goes to the
// first line's), so one stray CRLF in an LF file doesn't convert the whole file.
export function majorityEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length
  const lf = (text.match(/\n/g) || []).length - crlf
  if (crlf !== lf) return crlf > lf ? '\r\n' : '\n'
  const first = text.indexOf('\n')
  return first > 0 && text[first - 1] === '\r' ? '\r\n' : '\n'
}

// Unsaved edits survive the editor going away (another app view, a snapshot that briefly loses the
// worktree) for this window's lifetime; a reload loses them. Kept outside React, with listeners, so
// the worktree panel can point at them.
const drafts = new Map()
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }
const prefixOf = (repoPath, worktreePath) => `${repoPath}|${worktreePath}|`
const draftKey = (repoPath, worktreePath, path) => `${prefixOf(repoPath, worktreePath)}${path}`
// Only a draft appearing or going changes what the markers show, so edits to an existing one stay quiet.
const putDraft = (key, d) => { const isNew = !drafts.has(key); drafts.set(key, d); if (isNew) emit() }
const dropDraft = key => { if (drafts.delete(key)) emit() }
// Saves still writing, so a file reopened mid-save waits for the outcome instead of seeing stale state.
const pendingSaves = new Map()

// The conflict editor (use-conflict.js) keeps its unsaved result text in this same store.
export { draftKey as worktreeDraftKey }
export const getWorktreeDraft = key => drafts.get(key)
export const putWorktreeDraft = putDraft
export const dropWorktreeDraft = dropDraft

export function worktreeDraftPaths(repoPath, worktreePath) {
  const prefix = prefixOf(repoPath, worktreePath)
  return [...drafts.keys()].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length))
}
// Discarding edits (the panel's "Discard unsaved changes?") must also forget the kept draft.
export function discardWorktreeDraft(repoPath, worktreePath, path) { dropDraft(draftKey(repoPath, worktreePath, path)) }
export function clearWorktreeDrafts() { if (drafts.size) { drafts.clear(); emit() } }
export function useWorktreeDraftsVersion() {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    const l = () => setVersion(v => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return version
}

// One worktree file open for editing. Text is held LF-only; the file's line ending and BOM are
// remembered from the read and put back on save. Saves carry the read's stamp, so a file changed
// on disk since is reported as a conflict instead of overwritten. Unsaved edits are kept as a
// draft (above) and restored, checked against the file on disk, when the file is opened again.
export function useWorktreeFile({ adapter, repo, worktreePath, registered, path }) {
  const [s, setS] = React.useState(path == null ? EMPTY : { ...EMPTY, status: 'loading' })
  const latest = React.useRef(s)
  latest.current = s
  const gen = React.useRef(0)
  // Only the file's identity reloads it; fresh-but-equal adapter/repo/registered objects must not wipe edits.
  const deps = React.useRef({ adapter, repo, worktreePath, registered })
  deps.current = { adapter, repo, worktreePath, registered }
  // Set synchronously so two saves in the same tick can't both pass the guard.
  const busy = React.useRef(false)
  const repoPath = repo?.path
  const key = path == null ? null : draftKey(repoPath, worktreePath, path)

  const load = React.useCallback(async ({ discardDraft = false } = {}) => {
    const mine = ++gen.current
    busy.current = false
    if (path == null) { setS(EMPTY); return }
    setS({ ...EMPTY, status: 'loading' })
    const pending = pendingSaves.get(key)
    if (pending) {
      try { await pending } catch { /* the save reports its own failure */ }
      if (gen.current !== mine) return
    }
    if (discardDraft) dropDraft(key)
    const d = deps.current
    const draft = drafts.get(key)
    if (draft) {
      setS({ ...EMPTY, ...draft, status: 'ready', restored: true })
      // The draft may be older than the file: say so now rather than at Save.
      try {
        const r = await d.adapter.readFile(d.repo, d.worktreePath, d.registered, path)
        if (gen.current !== mine) return
        if (r.missing) setS(p => ({ ...p, error: `${path} no longer exists.` }))
        else if (r.stamp !== draft.stamp) setS(p => ({ ...p, conflict: true }))
      } catch { /* the draft stays on screen; Save reports a real problem */ }
      return
    }
    try {
      const r = await d.adapter.readFile(d.repo, d.worktreePath, d.registered, path)
      if (gen.current !== mine) return
      if (r.missing) { setS({ ...EMPTY, status: 'error', error: `${path} no longer exists.` }); return }
      const text = toLf(r.text)
      setS({ ...EMPTY, status: 'ready', text, saved: text, eol: majorityEol(r.text), bom: !!r.bom, stamp: r.stamp })
    } catch (e) {
      if (gen.current === mine) setS({ ...EMPTY, status: 'error', error: ipcMessage(e) || 'Could not read the file.' })
    }
  }, [path, key])

  React.useEffect(() => { load() }, [load])

  const setText = React.useCallback(text => {
    const p = latest.current
    if (key != null && p.status === 'ready') {
      if (text !== p.saved) putDraft(key, { text, saved: p.saved, eol: p.eol, bom: p.bom, stamp: p.stamp })
      else dropDraft(key)
    }
    setS(q => ({ ...q, text }))
  }, [key])

  const dirty = s.status === 'ready' && s.text !== s.saved

  const doSave = async ({ overwrite }) => {
    const p = latest.current
    const mine = gen.current
    // Typing continues during the write, so only what was actually sent counts as saved.
    const written = p.text
    setS(q => ({ ...q, saving: true, error: null }))
    try {
      const d = deps.current
      const r = await d.adapter.writeFile(d.repo, d.worktreePath, d.registered, path, fromLf(written, p.eol), { expectedStamp: p.stamp, overwrite, bom: p.bom })
      // The kept draft is settled even if the editor has gone or moved on meanwhile.
      if (r?.ok) {
        const kept = drafts.get(key)
        if (kept) {
          if (kept.text === written) dropDraft(key)
          else putDraft(key, { ...kept, saved: written, stamp: r.stamp })
        }
      }
      if (gen.current !== mine) return false
      busy.current = false
      if (r?.conflict) { setS(q => ({ ...q, saving: false, conflict: true })); return false }
      if (r?.missing) { setS(q => ({ ...q, saving: false, error: `${path} no longer exists.` })); return false }
      if (!r?.ok) { setS(q => ({ ...q, saving: false, error: 'Save failed.' })); return false }
      setS(q => ({ ...q, saving: false, saved: written, stamp: r.stamp, conflict: false, restored: false }))
      return true
    } catch (e) {
      if (gen.current === mine) { busy.current = false; setS(q => ({ ...q, saving: false, error: ipcMessage(e) || 'Save failed.' })) }
      return false
    }
  }

  const save = React.useCallback(({ overwrite = false } = {}) => {
    if (latest.current.status !== 'ready' || busy.current) return Promise.resolve(false)
    busy.current = true
    const p = doSave({ overwrite })
    pendingSaves.set(key, p)
    const done = () => { if (pendingSaves.get(key) === p) pendingSaves.delete(key) }
    p.then(done, done)
    return p
  // doSave reads everything else through refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key])

  const revert = React.useCallback(() => load({ discardDraft: true }), [load])

  return { status: s.status, text: s.text, setText, dirty, saving: s.saving, error: s.error, conflict: s.conflict, restored: s.restored, save, revert }
}
