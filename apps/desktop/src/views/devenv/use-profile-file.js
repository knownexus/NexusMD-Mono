import React from 'react'
import { validateProfileFile, detectEol, toLf, fromLf } from '@nexusmd/core'

// Unsaved edits survive switching files or tabs for this window's lifetime.
const drafts = new Map()
const EMPTY = { status: 'loading', text: '', saved: '', eol: '\n', bom: false, mtimeMs: null, missing: false, error: null, conflict: null, saving: false, restored: false }

const draftKey = (config, path) => `${config.root}|${config.profile}|${path}`

// Without this, "Discard changes" would still bring the draft back on the next visit.
export function discardProfileDraft(config, path) {
  drafts.delete(draftKey(config, path))
}

export function useProfileFile({ adapter, config, path }) {
  const key = draftKey(config, path)
  const [s, setS] = React.useState(EMPTY)
  const live = React.useRef(key)
  live.current = key

  const load = React.useCallback(async ({ discardDraft = false } = {}) => {
    if (discardDraft) drafts.delete(key)
    const d = drafts.get(key)
    if (d) { setS({ ...EMPTY, ...d, status: 'ready', restored: true }); return }
    setS(p => ({ ...p, status: 'loading', error: null, conflict: null }))
    try {
      const r = await adapter.profileRead(config, path)
      if (live.current !== key) return
      if (r.missing) { setS({ ...EMPTY, status: 'ready', missing: true }); return }
      const text = toLf(r.text)
      setS({ ...EMPTY, status: 'ready', text, saved: text, eol: detectEol(r.text), bom: !!r.bom, mtimeMs: r.mtimeMs })
    } catch (e) {
      if (live.current === key) setS({ ...EMPTY, status: 'error', error: e?.message || 'Could not read the file.' })
    }
  }, [adapter, config, path, key])

  React.useEffect(() => { load() }, [load])

  const setText = React.useCallback(text => setS(p => {
    if (text !== p.saved) drafts.set(key, { text, saved: p.saved, eol: p.eol, bom: p.bom, mtimeMs: p.mtimeMs, missing: p.missing })
    else drafts.delete(key)
    return { ...p, text }
  }), [key])

  const errors = React.useMemo(() => (s.status === 'ready' ? validateProfileFile(path, s.text) : []), [path, s.text, s.status])
  const dirty = s.status === 'ready' && s.text !== s.saved

  const save = React.useCallback(async ({ overwrite = false } = {}) => {
    if (errors.length) return false
    // Typing continues during the write, so only what was actually sent counts as saved.
    const written = s.text
    setS(p => ({ ...p, saving: true, error: null }))
    try {
      const r = await adapter.profileWrite(config, path, fromLf(written, s.eol), { expectedMtimeMs: s.mtimeMs, overwrite, bom: s.bom, create: s.missing })
      if (r.conflict) { setS(p => ({ ...p, saving: false, conflict: { mtimeMs: r.mtimeMs } })); return false }
      if (r.missing) { setS(p => ({ ...p, saving: false, missing: true, mtimeMs: null, error: `${path} no longer exists on disk - Save again to create it.` })); return false }
      setS(p => {
        if (p.text === written) drafts.delete(key)
        else drafts.set(key, { text: p.text, saved: written, eol: p.eol, bom: p.bom, mtimeMs: r.mtimeMs, missing: false })
        return { ...p, saving: false, saved: written, mtimeMs: r.mtimeMs, conflict: null, missing: false, restored: false }
      })
      return true
    } catch (e) {
      setS(p => ({ ...p, saving: false, error: e?.message || 'Save failed.' }))
      return false
    }
  }, [adapter, config, path, key, s.text, s.eol, s.bom, s.mtimeMs, s.missing, errors])

  const revert = React.useCallback(() => load({ discardDraft: true }), [load])
  return { ...s, setText, errors, dirty, save, revert }
}
