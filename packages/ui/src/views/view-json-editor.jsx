// view-json-editor.jsx — full React port of docs/json-editor.html: a two-pane
// JSON editor (tree view + raw text), styled with the app's theme tokens
// instead of the original's own hardcoded light palette.
import React from 'react'
import { Icon } from '../icons.jsx'
import { jsonAutoName, typeOf, setValueAtPath, deleteAtPath, allContainerPaths, highlightSegments, searchPaths, pathKey as searchKey, rendererLog, ignore } from '@nexusmd/core'
import { useDocumentAutosave, relativeTime } from './document-store.js'
import { DocumentsModal } from './documents-modal.jsx'
import { JsonNodeSheet } from '../json-tree-ui.jsx'

const log = rendererLog('editor', 'json')

const { useState, useEffect, useRef, useCallback, useMemo } = React

const SAMPLE = {
  name: 'Alice Johnson',
  age: 28,
  active: true,
  role: null,
  address: { street: '12 Oak Avenue', city: 'Bristol', postcode: 'BS1 4QX' },
  tags: ['developer', 'designer', 'mentor'],
  score: 94.5,
}
const SAMPLE_TEXT = JSON.stringify(SAMPLE, null, 2)
const EMPTY_TEXT = '{}'
const DOCS_STORAGE_KEY = 'json_editor_documents'

function parseOr(text, fallback) {
  try { return JSON.parse(text) } catch { return fallback }
}

// `openNewest`: the app was opened with a file, which is the newest saved document. It is shown as it is, and a
// document that is not valid JSON shows its error over an empty tree rather than the sample. `openDocId` opens that
// saved document the same way (a Home shortcut to it).
export function JsonEditorView({ openNewest = false, openDocId = null }) {
  const {
    content: rawText, setContent: setRawText, docs, currentDocId, hasUnsavedContent,
    openDoc, newDoc, deleteDoc, renameDoc,
  } = useDocumentAutosave({
    storageKey: DOCS_STORAGE_KEY,
    initialContent: SAMPLE_TEXT,
    emptyContent: EMPTY_TEXT,
    isEmpty: t => !t.trim(),
    extractAutoName: jsonAutoName,
    openNewest,
    openDocId,
  })

  const [showDocsModal, setShowDocsModal] = useState(false)
  const [data, setData] = useState(() => parseOr(rawText, openNewest || openDocId ? {} : SAMPLE))
  const [rawError, setRawError] = useState(null)
  const [history, setHistory] = useState(() => [rawText])
  const [histIdx, setHistIdx] = useState(0)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selectedPath, setSelectedPath] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [sheet, setSheet] = useState(null) // { path, adding } — the node being edited, or a group/list being added to
  const [panelHidden, setPanelHidden] = useState({ left: false, right: false })
  const [leftWidth, setLeftWidth] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)

  const toastTimerRef = useRef(null)
  const fileInputRef = useRef(null)
  const workspaceRef = useRef(null)
  const draggingRef = useRef(false)

  // Derives the tree (`data`) and error state from `rawText` — the single
  // source of truth for content, whether it changed via typing, undo/redo,
  // a tree edit (commit), or the document system (open/new/delete). Only
  // updates `data` on a successful parse, so the tree keeps showing the last
  // valid value while `rawText` is transiently invalid (e.g. mid-edit).
  useEffect(() => {
    // Blank text is an empty document (an opened empty file, or everything deleted), not an error.
    if (!rawText.trim()) { setData({}); setRawError(null); return }
    try {
      const parsed = JSON.parse(rawText)
      setData(parsed)
      setRawError(null)
    } catch (err) {
      setRawError(err.message)
    }
  }, [rawText])

  // While searching, only the matching nodes and the groups above them are shown (all opened).
  const search = useMemo(() => searchPaths(data, searchTerm), [data, searchTerm])

  const pushHistory = useCallback((text) => {
    setHistory(prev => [...prev.slice(0, histIdx + 1), text])
    setHistIdx(prev => prev + 1)
  }, [histIdx])

  // Applies a new tree, keeping the raw pane and history in sync with it.
  // (data/rawError update via the effect above, once rawText's new value
  // is parsed.)
  const commit = useCallback((nextData) => {
    const text = JSON.stringify(nextData, null, 2)
    setRawText(text)
    pushHistory(text)
  }, [pushHistory, setRawText])

  function showToast(msg) {
    clearTimeout(toastTimerRef.current)
    setToastMsg(msg)
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2000)
  }

  function undo() {
    setHistIdx(idx => {
      if (idx === 0) return idx
      const nextIdx = idx - 1
      setRawText(history[nextIdx])
      return nextIdx
    })
  }
  function redo() {
    setHistIdx(idx => {
      if (idx === history.length - 1) return idx
      const nextIdx = idx + 1
      setRawText(history[nextIdx])
      return nextIdx
    })
  }

  // The undo/redo history stack (and tree UI state like collapsed/selected
  // paths) is JSON-Editor-specific state the shared useDocumentAutosave hook
  // has no knowledge of — it only tracks `content`. Without resetting it
  // here, opening/creating/deleting a document leaves stale snapshots from
  // the *previous* document's editing session in `history`, so undo/redo
  // can pull in — and the debounced autosave can silently persist — another
  // document's content into whichever document is now open. These wrappers
  // reset history to a single entry (mirroring the initial-mount seeding
  // `useState(() => [rawText])` / `histIdx = 0`) whenever the buffer's
  // content is programmatically replaced by the document system.
  function resetEditorState(text) {
    setHistory([text])
    setHistIdx(0)
    setCollapsed(new Set())
    setSelectedPath([])
  }
  function handleOpenDoc(id) {
    const doc = docs.find(d => d.id === id)
    openDoc(id)
    if (doc) resetEditorState(doc.content)
  }
  function handleNewDoc() {
    newDoc()
    resetEditorState(EMPTY_TEXT)
  }
  function handleDeleteDoc(id) {
    deleteDoc(id)
    if (currentDocId === id) resetEditorState(EMPTY_TEXT)
  }

  function onRawChange(e) {
    const text = e.target.value
    setRawText(text)
    try {
      JSON.parse(text)
      pushHistory(text)
    } catch (err) { ignore(log, 'the text is not valid JSON; the raw-text effect reports it', err, 'debug') }
  }

  function formatRaw() {
    try {
      const parsed = JSON.parse(rawText)
      commit(parsed)
      showToast('Formatted ✓')
    } catch {
      setRawError('Cannot format — fix errors first')
    }
  }

  function expandAll() { setCollapsed(new Set()) }
  function collapseAll() { setCollapsed(new Set(allContainerPaths(data))) }

  function copyJSON() {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => showToast('Copied to clipboard ✓'))
  }
  function downloadJSON() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'data.json'
    a.click()
    showToast('Downloaded ✓')
  }
  function openFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        commit(parsed)
        showToast(`Opened: ${file.name}`)
      } catch { showToast('Error: invalid JSON file') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Editing and adding go through the shared node sheet (@nexusmd/ui json-tree-ui.jsx), which checks
  // the change with @nexusmd/core (no duplicate names, numbers must be numbers) before it is applied.
  function openAddModal(path) { setSheet({ path, adding: true }) }
  function openEditModal(path) { setSheet({ path, adding: false }) }
  function closeSheet() { setSheet(null) }
  function applySheet(next, message) {
    commit(next)
    showToast(message)
  }

  // Keyboard shortcuts — read the latest handlers via a ref so this effect
  // mounts once instead of re-subscribing (and risking stale closures) on
  // every render.
  const latestRef = useRef(null)
  latestRef.current = { undo, redo, downloadJSON, sheet }
  useEffect(() => {
    function onKeyDown(e) {
      const cur = latestRef.current
      if (cur.sheet) return // the sheet handles its own keys (Escape closes it)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); cur.undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); cur.redo() }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); cur.downloadJSON() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function onResizerMouseDown() {
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
  useEffect(() => {
    function onMove(e) {
      if (!draggingRef.current || !workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const w = Math.max(180, Math.min(rect.width - 185, e.clientX - rect.left))
      setLeftWidth(w)
    }
    function onUp() {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
  }, [])

  function togglePanel(side) {
    setPanelHidden(prev => ({ ...prev, [side]: !prev[side] }))
  }

  const leftStyle = panelHidden.left
    ? { display: 'none' }
    : panelHidden.right
      ? { flex: '1 1 100%' }
      : leftWidth !== null ? { flex: `0 0 ${leftWidth}px` } : { flex: '1 1 50%' }
  const rightStyle = panelHidden.right
    ? { display: 'none' }
    : panelHidden.left
      ? { flex: '1 1 100%' }
      : { flex: '1 1 50%' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
      <style>{`
        .je-btn { display:inline-flex; align-items:center; gap:5px; padding:5px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:transparent; color:var(--text-muted); cursor:pointer; font-size:12px; white-space:nowrap; }
        .je-btn:hover { background:var(--surface-2); color:var(--text); }
        .je-btn:disabled { opacity:.4; cursor:not-allowed; }
        .je-sep { width:1px; height:18px; background:var(--border); margin:0 2px; flex-shrink:0; }
        .je-row { display:flex; align-items:center; padding:2px 6px 2px 4px; border-radius:5px; min-height:28px; cursor:default; }
        .je-row:hover { background:var(--surface-2); }
        .je-row.selected { background:var(--accent-soft); }
        .je-actions { margin-left:auto; display:flex; gap:1px; opacity:0; }
        .je-row:hover .je-actions { opacity:1; }
        .je-icon-btn { width:22px; height:22px; display:inline-flex; align-items:center; justify-content:center; border:none; background:transparent; color:var(--text-subtle); cursor:pointer; border-radius:4px; }
        .je-icon-btn:hover { background:var(--surface); color:var(--text); }
        .je-icon-btn.danger:hover { color:var(--danger); }
        mark { background: var(--warning-soft); color: inherit; border-radius:2px; }
      `}</style>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', minHeight: 44, boxSizing: 'border-box', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, marginRight: 4 }}>JSON Editor</span>
        <div className="je-sep"/>
        <button className="je-btn" disabled={histIdx === 0} onClick={undo} title="Ctrl+Z"><Icon name="undo" size={13}/> Undo</button>
        <button className="je-btn" disabled={histIdx === history.length - 1} onClick={redo} title="Ctrl+Y"><Icon name="redo" size={13}/> Redo</button>
        <div className="je-sep"/>
        <button className="je-btn" onClick={expandAll}><Icon name="expand" size={13}/> Expand</button>
        <button className="je-btn" onClick={collapseAll}><Icon name="collapse" size={13}/> Collapse</button>
        <div className="je-sep"/>
        <input
          value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search…"
          style={{ padding: '5px 9px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, outline: 'none', width: 140 }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="je-btn" onClick={handleNewDoc}><Icon name="plus" size={13}/> New</button>
          <button className="je-btn" onClick={() => setShowDocsModal(true)}>
            <Icon name="doc" size={13}/> Documents{docs.length > 0 ? ` (${docs.length})` : ''}
          </button>
          <div className="je-sep"/>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 99, fontSize: 11.5, fontWeight: 600,
            background: rawError === null ? 'var(--success-soft)' : 'var(--danger-soft)',
            color: rawError === null ? 'var(--success)' : 'var(--danger)',
          }}>
            <Icon name={rawError === null ? 'check-circle' : 'alert'} size={12}/> {rawError === null ? 'Valid JSON' : 'Invalid'}
          </span>
          <div className="je-sep"/>
          <label className="je-btn" style={{ cursor: 'pointer' }}>
            <Icon name="upload" size={13}/> Open
            <input ref={fileInputRef} type="file" accept=".json" onChange={openFile} style={{ display: 'none' }}/>
          </label>
          <button className="je-btn" onClick={copyJSON}><Icon name="copy" size={13}/> Copy</button>
          <button className="je-btn" onClick={downloadJSON} title="Ctrl+S"><Icon name="download" size={13}/> Save</button>
        </div>
      </div>

      {/* Workspace */}
      <div ref={workspaceRef} className="doc-workspace" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ ...leftStyle, display: panelHidden.left ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Raw JSON</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className="je-btn" title="Validate the raw JSON and re-indent it" onClick={formatRaw}><Icon name="wand" size={13}/> Validate & Format</button>
              <button className="je-icon-btn" title="Hide panel" onClick={() => togglePanel('left')}><Icon name="chevron-left" size={13}/></button>
            </div>
          </div>
          <textarea
            value={rawText} onChange={onRawChange} spellCheck={false}
            style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', padding: '14px 18px', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.65, background: 'var(--surface)', color: 'var(--text)' }}
          />
          {rawError && (
            <div style={{ padding: '7px 14px', fontSize: 11.5, color: 'var(--danger)', background: 'var(--danger-soft)', borderTop: '1px solid var(--border)', fontFamily: 'var(--mono)' }}>
              ⚠ {rawError}
            </div>
          )}
        </div>

        {!panelHidden.left && !panelHidden.right && (
          <div onMouseDown={onResizerMouseDown} style={{ width: 5, flexShrink: 0, background: 'var(--border)', cursor: 'col-resize' }}/>
        )}

        <div style={{ ...rightStyle, display: panelHidden.right ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--surface)' }}>
          <div style={{ height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Visual editor</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className="je-icon-btn" title="Add field" onClick={() => openAddModal([], typeOf(data) === 'array' ? 'array' : 'object')}><Icon name="plus" size={13}/></button>
              <button className="je-icon-btn" title="Hide panel" onClick={() => togglePanel('right')}><Icon name="chevron-right" size={13}/></button>
            </div>
          </div>
          <div style={{ padding: '4px 12px', fontSize: 10.5, color: 'var(--text-subtle)', fontFamily: 'var(--mono)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {selectedPath.length ? '/ ' + selectedPath.join(' / ') : '/'}
          </div>
          {search.active && (
            <div role="status" style={{ padding: '4px 12px', fontSize: 11.5, color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' }}>
              {search.count} match{search.count === 1 ? '' : 'es'}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 4px 20px' }}>
            {search.active && search.count === 0 ? (
              <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: 12.5 }}>Nothing matches “{searchTerm.trim()}”.</div>
            ) : (
              <JsonTreeNode
                value={data} keyLabel="root" path={[]} searchTerm={searchTerm} search={search}
                collapsed={collapsed} setCollapsed={setCollapsed} selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onInlineCommit={(path, val) => commit(setValueAtPath(data, path, val))}
                onOpenAdd={openAddModal} onOpenEdit={openEditModal}
                onDelete={(path) => commit(deleteAtPath(data, path))}
              />
            )}
          </div>
        </div>
      </div>

      <JsonNodeSheet overlay data={data} path={sheet?.path ?? null} startAdding={!!sheet?.adding}
        onClose={closeSheet} onApply={applySheet}/>

      {showDocsModal && (
        <DocumentsModal
          docs={docs}
          currentDocId={currentDocId}
          hasUnsavedContent={hasUnsavedContent}
          onOpen={id => { handleOpenDoc(id); setShowDocsModal(false) }}
          onNew={() => { handleNewDoc(); setShowDocsModal(false) }}
          onDelete={handleDeleteDoc}
          onRename={renameDoc}
          onClose={() => setShowDocsModal(false)}
          renderPreview={doc => (
            <pre style={{
              margin: 0, padding: '10px 12px', fontFamily: 'var(--mono)', fontSize: 10.5, lineHeight: 1.5,
              color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', height: '100%',
            }}>
              {doc.content || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Empty document</span>}
            </pre>
          )}
          metaText={doc => `${doc.content.length.toLocaleString()} chars · ${relativeTime(doc.updatedAt)}`}
        />
      )}

      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--text)', color: 'var(--bg)', padding: '7px 16px', borderRadius: 99, fontSize: 12.5, zIndex: 300,
        }}>{toastMsg}</div>
      )}
    </div>
  )
}

function JsonTreeNode({ value, keyLabel, path, searchTerm, search, collapsed, setCollapsed, selectedPath, onSelect, onInlineCommit, onOpenAdd, onOpenEdit, onDelete }) {
  const [editingInline, setEditingInline] = useState(false)
  const [inlineVal, setInlineVal] = useState('')

  const type = typeOf(value)
  const isContainer = type === 'object' || type === 'array'
  const pathKey = path.join('.')
  // A search hides what doesn't match and opens every group on the way to a match.
  const hidden = search.active && !search.show.has(searchKey(path))
  const isCollapsed = !search.active && collapsed.has(pathKey)
  const isSelected = selectedPath.join('.') === pathKey

  function toggle() {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(pathKey) ? next.delete(pathKey) : next.add(pathKey)
      return next
    })
  }

  function startInline() {
    if (isContainer || path.length === 0) return
    setInlineVal(value === null ? '' : String(value))
    setEditingInline(true)
  }
  function commitInline() {
    let newVal
    if (type === 'number') newVal = isNaN(Number(inlineVal)) ? value : Number(inlineVal)
    else if (type === 'boolean') newVal = inlineVal.toLowerCase() !== 'false' && inlineVal !== '0' && inlineVal !== ''
    else newVal = inlineVal
    setEditingInline(false)
    onInlineCommit(path, newVal)
  }

  function renderHighlighted(text) {
    return highlightSegments(text, searchTerm).map((seg, i) =>
      seg.match ? <mark key={i}>{seg.text}</mark> : <React.Fragment key={i}>{seg.text}</React.Fragment>
    )
  }

  if (hidden) return null
  return (
    <div>
      <div
        className={`je-row${isSelected ? ' selected' : ''}`}
        onClick={() => onSelect(path)}
        onDoubleClick={() => { if (!isContainer && path.length > 0) startInline(); else onOpenEdit(path, keyLabel, value) }}
      >
        {isContainer ? (
          <button onClick={(e) => { e.stopPropagation(); toggle() }} style={{ width: 20, height: 20, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-subtle)', flexShrink: 0 }}>
            <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={11}/>
          </button>
        ) : <span style={{ width: 20, flexShrink: 0 }}/>}

        {keyLabel !== 'root' && (
          <>
            <span className="je-key" style={{ fontWeight: 500, fontSize: 13, flexShrink: 0 }}>{renderHighlighted(String(keyLabel))}</span>
            <span style={{ color: 'var(--text-subtle)', margin: '0 6px 0 4px', flexShrink: 0 }}>→</span>
          </>
        )}

        {isContainer ? (
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', background: 'var(--surface-2)', padding: '1px 7px', borderRadius: 4, fontFamily: 'var(--mono)' }}>
            {type === 'object'
              ? (isCollapsed ? `{ ${Object.keys(value).length} field${Object.keys(value).length !== 1 ? 's' : ''} }` : '{ … }')
              : (isCollapsed ? `[ ${value.length} item${value.length !== 1 ? 's' : ''} ]` : '[ … ]')}
          </span>
        ) : editingInline ? (
          <input
            autoFocus value={inlineVal} onChange={e => setInlineVal(e.target.value)}
            onClick={e => e.stopPropagation()}
            onBlur={commitInline}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { e.stopPropagation(); setEditingInline(false) } }}
            style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 13, outline: 'none', minWidth: 60 }}
          />
        ) : (
          <ValuePill type={type} value={value} renderText={renderHighlighted}/>
        )}

        <div className="je-actions">
          {isContainer && (
            <button className="je-icon-btn" title="Add field here" onClick={e => { e.stopPropagation(); onOpenAdd(path, type) }}><Icon name="plus" size={12}/></button>
          )}
          <button className="je-icon-btn" title="Edit (or double-click)" onClick={e => { e.stopPropagation(); onOpenEdit(path, keyLabel, value) }}><Icon name="edit" size={12}/></button>
          {path.length > 0 && (
            <button className="je-icon-btn danger" title="Delete" onClick={e => { e.stopPropagation(); if (window.confirm(`Delete "${keyLabel}"?`)) onDelete(path) }}><Icon name="trash" size={12}/></button>
          )}
        </div>
      </div>

      {isContainer && !isCollapsed && (
        <div style={{ paddingLeft: 18, borderLeft: '1.5px solid var(--border)', marginLeft: 10 }}>
          {type === 'object'
            ? Object.entries(value).map(([k, v]) => (
                <JsonTreeNode key={k} value={v} keyLabel={k} path={[...path, k]} searchTerm={searchTerm} search={search}
                  collapsed={collapsed} setCollapsed={setCollapsed} selectedPath={selectedPath} onSelect={onSelect}
                  onInlineCommit={onInlineCommit} onOpenAdd={onOpenAdd} onOpenEdit={onOpenEdit} onDelete={onDelete}/>
              ))
            : value.map((v, i) => (
                <JsonTreeNode key={i} value={v} keyLabel={i} path={[...path, i]} searchTerm={searchTerm} search={search}
                  collapsed={collapsed} setCollapsed={setCollapsed} selectedPath={selectedPath} onSelect={onSelect}
                  onInlineCommit={onInlineCommit} onOpenAdd={onOpenAdd} onOpenEdit={onOpenEdit} onDelete={onDelete}/>
              ))}
        </div>
      )}
    </div>
  )
}

function ValuePill({ type, value, renderText }) {
  const styles = {
    string:  { background: 'var(--success-soft)', color: 'var(--success)' },
    number:  { background: 'var(--warning-soft)', color: 'var(--warning)' },
    boolean: value ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : { background: 'var(--surface-2)', color: 'var(--text-muted)' },
    null:    { background: 'var(--surface-2)', color: 'var(--text-subtle)', fontStyle: 'italic' },
  }
  const text = type === 'null' ? 'null' : String(value)
  return (
    <span style={{ display: 'inline-flex', padding: '1px 7px', borderRadius: 4, fontSize: 12, fontFamily: 'var(--mono)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...styles[type] }}>
      {renderText(text)}
    </span>
  )
}
