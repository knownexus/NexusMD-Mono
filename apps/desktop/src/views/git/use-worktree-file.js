import React from 'react'
import { detectEol, toLf, fromLf } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'

const EMPTY = { status: 'idle', text: '', saved: '', eol: '\n', bom: false, stamp: null, error: null, conflict: false, saving: false }

// One worktree file open for editing. Text is held LF-only; the file's own line endings and BOM
// are remembered from the read and put back on save. Saves carry the read's stamp, so a file
// changed on disk since is reported as a conflict instead of overwritten. No drafts are kept:
// the editor asks before leaving unsaved edits.
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

  const load = React.useCallback(async () => {
    const mine = ++gen.current
    busy.current = false
    if (path == null) { setS(EMPTY); return }
    setS({ ...EMPTY, status: 'loading' })
    try {
      const d = deps.current
      const r = await d.adapter.readFile(d.repo, d.worktreePath, d.registered, path)
      if (gen.current !== mine) return
      if (r.missing) { setS({ ...EMPTY, status: 'error', error: `${path} no longer exists.` }); return }
      const text = toLf(r.text)
      setS({ ...EMPTY, status: 'ready', text, saved: text, eol: detectEol(r.text), bom: !!r.bom, stamp: r.stamp })
    } catch (e) {
      if (gen.current === mine) setS({ ...EMPTY, status: 'error', error: ipcMessage(e) || 'Could not read the file.' })
    }
  }, [path, repoPath, worktreePath])

  React.useEffect(() => { load() }, [load])

  const setText = React.useCallback(text => { setS(p => ({ ...p, text })) }, [])

  const dirty = s.status === 'ready' && s.text !== s.saved

  const save = React.useCallback(async ({ overwrite = false } = {}) => {
    const p = latest.current
    if (p.status !== 'ready' || busy.current) return false
    busy.current = true
    const mine = gen.current
    // Typing continues during the write, so only what was actually sent counts as saved.
    const written = p.text
    setS(q => ({ ...q, saving: true, error: null }))
    try {
      const d = deps.current
      const r = await d.adapter.writeFile(d.repo, d.worktreePath, d.registered, path, fromLf(written, p.eol), { expectedStamp: p.stamp, overwrite, bom: p.bom })
      if (gen.current !== mine) return false
      busy.current = false
      if (r?.conflict) { setS(q => ({ ...q, saving: false, conflict: true })); return false }
      if (r?.missing) { setS(q => ({ ...q, saving: false, error: `${path} no longer exists.` })); return false }
      if (!r?.ok) { setS(q => ({ ...q, saving: false, error: 'Save failed.' })); return false }
      setS(q => ({ ...q, saving: false, saved: written, stamp: r.stamp, conflict: false }))
      return true
    } catch (e) {
      if (gen.current === mine) { busy.current = false; setS(q => ({ ...q, saving: false, error: ipcMessage(e) || 'Save failed.' })) }
      return false
    }
  }, [path])

  return { status: s.status, text: s.text, setText, dirty, saving: s.saving, error: s.error, conflict: s.conflict, save, revert: load }
}
