import React from 'react'
import { validateProfileFile, detectEol, toLf, fromLf } from '@nexusmd/core'

const EMPTY = { status: 'loading', text: '', saved: '', eol: '\n', bom: false, stamp: null, missing: false, error: null, conflict: null, saving: false, restored: false }

// Unsaved edits survive switching files or tabs for this window's lifetime (a reload loses them).
// Kept outside React, with listeners, so the file list and the Profile tab can mark them.
const drafts = new Map()
const listeners = new Set()
const emit = () => { for (const l of listeners) l() }
const draftKey = (config, path) => `${config.root}|${config.profile}|${path}`
const putDraft = (key, d) => { drafts.set(key, d); emit() }
const dropDraft = key => { if (drafts.delete(key)) emit() }

export const hasProfileDraft = (config, path) => drafts.has(draftKey(config, path))
export const hasProfileDrafts = () => drafts.size > 0
// Without this, "Revert" would still bring the draft back on the next visit.
export function discardProfileDraft(config, path) { dropDraft(draftKey(config, path)) }
export function clearProfileDrafts() { if (drafts.size) { drafts.clear(); emit() } }
export function useProfileDraftsVersion() {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    const l = () => setVersion(v => v + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
  return version
}

export function useProfileFile({ adapter, config, path }) {
  const key = draftKey(config, path)
  const [s, setS] = React.useState(EMPTY)
  const live = React.useRef(key)
  live.current = key
  // The latest state and text, for draft bookkeeping done outside state updaters.
  const latest = React.useRef(s)
  latest.current = s
  const typed = React.useRef('')

  const load = React.useCallback(async ({ discardDraft = false } = {}) => {
    if (discardDraft) dropDraft(key)
    const d = drafts.get(key)
    if (d) {
      typed.current = d.text
      setS({ ...EMPTY, ...d, status: 'ready', restored: true })
      // The draft may be older than the file: say so now rather than at Save.
      try {
        const r = await adapter.profileRead(config, path)
        if (live.current !== key) return
        if (r.missing) {
          if (!d.missing) setS(p => ({ ...p, missing: true, stamp: null, error: `${path} no longer exists on disk - Save again to create it.` }))
        } else if (d.missing || r.stamp !== d.stamp) {
          setS(p => ({ ...p, conflict: { stamp: r.stamp } }))
        }
      } catch { /* the draft stays on screen; Save reports a real problem */ }
      return
    }
    setS(p => ({ ...p, status: 'loading', error: null, conflict: null }))
    try {
      const r = await adapter.profileRead(config, path)
      if (live.current !== key) return
      if (r.missing) { typed.current = ''; setS({ ...EMPTY, status: 'ready', missing: true }); return }
      const text = toLf(r.text)
      typed.current = text
      setS({ ...EMPTY, status: 'ready', text, saved: text, eol: detectEol(r.text), bom: !!r.bom, stamp: r.stamp })
    } catch (e) {
      if (live.current === key) setS({ ...EMPTY, status: 'error', error: e?.message || 'Could not read the file.' })
    }
  }, [adapter, config, path, key])

  React.useEffect(() => { load() }, [load])

  const setText = React.useCallback(text => {
    const p = latest.current
    typed.current = text
    if (text !== p.saved) putDraft(key, { text, saved: p.saved, eol: p.eol, bom: p.bom, stamp: p.stamp, missing: p.missing })
    else dropDraft(key)
    setS(q => ({ ...q, text }))
  }, [key])

  const errors = React.useMemo(() => (s.status === 'ready' && !(s.missing && s.text === '') ? validateProfileFile(path, s.text) : []), [path, s.text, s.status, s.missing])
  const dirty = s.status === 'ready' && s.text !== s.saved

  const save = React.useCallback(async ({ overwrite = false } = {}) => {
    if (errors.length) return false
    // Typing continues during the write, so only what was actually sent counts as saved.
    const written = s.text
    setS(p => ({ ...p, saving: true, error: null }))
    try {
      const r = await adapter.profileWrite(config, path, fromLf(written, s.eol), { expectedStamp: s.stamp, overwrite, bom: s.bom, create: s.missing })
      if (r.conflict) { setS(p => ({ ...p, saving: false, conflict: { stamp: r.stamp } })); return false }
      if (r.missing) { setS(p => ({ ...p, saving: false, missing: true, stamp: null, error: `${path} no longer exists on disk - Save again to create it.` })); return false }
      const now = typed.current
      if (now === written) dropDraft(key)
      else putDraft(key, { text: now, saved: written, eol: s.eol, bom: s.bom, stamp: r.stamp, missing: false })
      setS(p => ({ ...p, saving: false, saved: written, stamp: r.stamp, conflict: null, missing: false, restored: false }))
      return true
    } catch (e) {
      setS(p => ({ ...p, saving: false, error: e?.message || 'Save failed.' }))
      return false
    }
  }, [adapter, config, path, key, s.text, s.eol, s.bom, s.stamp, s.missing, errors])

  const revert = React.useCallback(() => load({ discardDraft: true }), [load])
  return { ...s, setText, errors, dirty, save, revert }
}
