import { toLf, fromLf } from '@nexusmd/core'

// What the Editor app holds: the open files (with their unsaved edits), which one is showing, the
// folder in the tree, and recently opened paths. It lives outside React so other apps can open a
// file through the editor.openPath capability while the Editor screen isn't showing, and so its
// rules can be tested without a screen. Unsaved edits live here, so leaving the screen keeps them.
//
// A file's text is held LF-only; its line ending and BOM come from the read and go back on save.
// A save carries the stamp (SHA-256) of the read it is based on, so a file changed on disk since is
// reported as a conflict instead of overwritten.

const RECENT_MAX = 12

// The line ending a file is written back with: whichever its lines mostly use (a tie goes to the
// first line's), so one stray CRLF in an LF file doesn't convert the whole file.
export function majorityEol(text) {
  const crlf = (text.match(/\r\n/g) || []).length
  const lf = (text.match(/\n/g) || []).length - crlf
  if (crlf !== lf) return crlf > lf ? '\r\n' : '\n'
  const first = text.indexOf('\n')
  return first > 0 && text[first - 1] === '\r' ? '\r\n' : '\n'
}

// The message of an error that crossed IPC, without Electron's "Error invoking remote method" wrapper.
export function ipcMessage(e) {
  return String(e?.message ?? e ?? '').replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '').trim()
}

export const baseName = p => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p)
export const isDirty = d => !!d && d.status === 'ready' && d.text !== d.saved

const sameDoc = (a, b) => (/^[a-z]:|^\\\\/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b)

export function createEditorStore({ api, storage = null, recentKey = 'nexusmd.editor.recent' }) {
  let state = { folder: null, docs: [], active: null, recent: { files: [], folders: [] }, notice: null }
  const listeners = new Set()
  const set = patch => { state = { ...state, ...patch }; listeners.forEach(l => l()) }
  const patchDoc = (path, patch) => set({ docs: state.docs.map(d => (sameDoc(d.path, path) ? { ...d, ...(typeof patch === 'function' ? patch(d) : patch) } : d)) })
  const find = path => state.docs.find(d => sameDoc(d.path, path))
  // Reads that finished after their file was reloaded or closed must not overwrite newer state.
  const gen = new Map()
  const nextGen = path => { const n = (gen.get(path) ?? 0) + 1; gen.set(path, n); return n }
  const current = (path, n) => gen.get(path) === n && !!find(path)

  try {
    const saved = JSON.parse(storage?.get(recentKey) ?? 'null')
    if (saved && Array.isArray(saved.files) && Array.isArray(saved.folders)) state.recent = { files: saved.files.slice(0, RECENT_MAX), folders: saved.folders.slice(0, RECENT_MAX) }
  } catch { /* an unreadable list starts empty */ }

  function remember(kind, path) {
    const list = [path, ...state.recent[kind].filter(p => !sameDoc(p, path))].slice(0, RECENT_MAX)
    const recent = { ...state.recent, [kind]: list }
    set({ recent })
    try { storage?.set(recentKey, JSON.stringify(recent)) } catch { /* not remembering is fine */ }
  }

  async function load(path, { line = null } = {}) {
    const n = nextGen(path)
    patchDoc(path, { status: 'loading', error: null, conflict: false, line })
    try {
      const r = await api.read(path)
      if (!current(path, n)) return
      if (r.missing) { patchDoc(path, { status: 'error', error: `${baseName(path)} no longer exists.` }); return }
      const text = toLf(r.text)
      patchDoc(path, { status: 'ready', text, saved: text, eol: majorityEol(r.text), bom: !!r.bom, stamp: r.stamp, error: null, conflict: false, saving: false })
    } catch (e) {
      if (current(path, n)) patchDoc(path, { status: 'error', error: ipcMessage(e) || 'Could not read the file.' })
    }
  }

  async function openFile(path, { line = null } = {}) {
    const existing = find(path)
    if (existing) {
      set({ active: existing.path, notice: null })
      // A new object each time, so asking for the same line again still jumps there.
      if (line != null) patchDoc(existing.path, { line: { line } })
      return
    }
    const doc = { path, name: baseName(path), status: 'loading', text: '', saved: '', eol: '\n', bom: false, stamp: null, error: null, conflict: false, saving: false, line: line != null ? { line } : null }
    set({ docs: [...state.docs, doc], active: path, notice: null })
    remember('files', path)
    await load(path, { line: line != null ? { line } : null })
  }

  function openFolder(dir) {
    set({ folder: dir, notice: null })
    remember('folders', dir)
  }

  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    openFile,
    openFolder,

    // A file or a folder, whichever the path turns out to be.
    async openPath(path, { line = null } = {}) {
      try {
        const st = await api.stat(path)
        if (!st.exists) { set({ notice: `${path} doesn't exist.` }); return false }
        if (st.kind === 'dir') { openFolder(path); return true }
        if (st.kind !== 'file') { set({ notice: `${path} isn't a file or a folder.` }); return false }
        await openFile(path, { line })
        return true
      } catch (e) {
        set({ notice: ipcMessage(e) || `Could not open ${path}.` })
        return false
      }
    },

    activate(path) { const d = find(path); if (d) set({ active: d.path }) },
    dismissNotice() { set({ notice: null }) },
    closeFolder() { set({ folder: null }) },

    // Closing drops the file and its unsaved edits (the screen asks first when there are any).
    close(path) {
      const i = state.docs.findIndex(d => sameDoc(d.path, path))
      if (i < 0) return
      const docs = state.docs.filter((_, j) => j !== i)
      gen.delete(state.docs[i].path)
      const active = sameDoc(state.active ?? '', path) ? (docs[Math.min(i, docs.length - 1)]?.path ?? null) : state.active
      set({ docs, active })
    },

    setText(path, text) {
      const d = find(path)
      if (d && d.status === 'ready' && d.text !== text) patchDoc(path, { text })
    },

    // Throws away the edits and reads the file again.
    reload(path) { return find(path) ? load(path) : Promise.resolve() },

    async save(path, { overwrite = false } = {}) {
      const d = find(path)
      if (!d || d.status !== 'ready' || d.saving) return false
      // Typing continues during the write, so only what was actually sent counts as saved.
      const written = d.text
      patchDoc(path, { saving: true, error: null })
      try {
        const r = await api.write(path, fromLf(written, d.eol), { expectedStamp: d.stamp, overwrite, bom: d.bom })
        if (!find(path)) return false
        if (r?.conflict) { patchDoc(path, { saving: false, conflict: true }); return false }
        if (r?.missing) { patchDoc(path, { saving: false, error: `${d.name} no longer exists. Save again to create it.`, stamp: null }); return false }
        if (!r?.ok) { patchDoc(path, { saving: false, error: 'Save failed.' }); return false }
        patchDoc(path, { saving: false, saved: written, stamp: r.stamp, conflict: false, error: null })
        return true
      } catch (e) {
        if (find(path)) patchDoc(path, { saving: false, error: ipcMessage(e) || 'Save failed.' })
        return false
      }
    },
  }
}
