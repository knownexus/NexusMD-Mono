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
  const typed = React.useRef('')
  const gen = React.useRef(0)
  const missingMsg = `${path} no longer exists.`

  const load = React.useCallback(async () => {
    const mine = ++gen.current
    if (path == null) { typed.current = ''; setS(EMPTY); return }
    setS({ ...EMPTY, status: 'loading' })
    try {
      const r = await adapter.readFile(repo, worktreePath, registered, path)
      if (gen.current !== mine) return
      if (r.missing) { setS({ ...EMPTY, status: 'error', error: `${path} no longer exists.` }); return }
      const text = toLf(r.text)
      typed.current = text
      setS({ ...EMPTY, status: 'ready', text, saved: text, eol: detectEol(r.text), bom: !!r.bom, stamp: r.stamp })
    } catch (e) {
      if (gen.current === mine) setS({ ...EMPTY, status: 'error', error: ipcMessage(e) || 'Could not read the file.' })
    }
  }, [adapter, repo, worktreePath, registered, path])

  React.useEffect(() => { load() }, [load])

  const setText = React.useCallback(text => {
    typed.current = text
    setS(p => ({ ...p, text }))
  }, [])

  const dirty = s.status === 'ready' && s.text !== s.saved

  const save = React.useCallback(async ({ overwrite = false } = {}) => {
    const p = latest.current
    if (p.status !== 'ready' || p.saving) return false
    const mine = gen.current
    // Typing continues during the write, so only what was actually sent counts as saved.
    const written = p.text
    setS(q => ({ ...q, saving: true, error: null }))
    try {
      const r = await adapter.writeFile(repo, worktreePath, registered, path, fromLf(written, p.eol), { expectedStamp: p.stamp, overwrite, bom: p.bom })
      if (gen.current !== mine) return false
      if (r.conflict) { setS(q => ({ ...q, saving: false, conflict: true })); return false }
      if (r.missing) { setS(q => ({ ...q, saving: false, error: missingMsg })); return false }
      setS(q => ({ ...q, saving: false, saved: written, stamp: r.stamp, conflict: false }))
      return true
    } catch (e) {
      if (gen.current === mine) setS(q => ({ ...q, saving: false, error: ipcMessage(e) || 'Save failed.' }))
      return false
    }
  }, [adapter, repo, worktreePath, registered, path, missingMsg])

  return { status: s.status, text: s.text, setText, dirty, saving: s.saving, error: s.error, conflict: s.conflict, save, revert: load }
}
