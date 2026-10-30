import React from 'react'
import { CodeEditor, languageForPath } from '@nexusmd/editor-kit/code-editor.jsx'
import { MarkdownPreview } from '@nexusmd/ui'
import { FolderTree } from './folder-tree.jsx'
import { editorApi, editorStore, useEditorStore } from './editor-singleton.js'
import { isDirty, baseName } from './editor-store.js'
import './editor.css'

const eolLabel = eol => (eol === '\r\n' ? 'CRLF' : 'LF')

function Tab({ doc, active, onSelect, onClose }) {
  return (
    <div role="tab" aria-selected={active} className={`nx-ed-tab${active ? ' nx-ed-active' : ''}`} title={doc.readOnly ? `${doc.origin} (read-only)` : doc.path}>
      <button type="button" className="nx-ed-tab-name" onClick={onSelect}>
        {doc.name}{isDirty(doc) && <span className="nx-ed-dirty" title="Unsaved changes" aria-label="unsaved changes"> ●</span>}
      </button>
      <button type="button" className="nx-ed-tab-close" aria-label={`Close ${doc.name}`} onClick={onClose}>×</button>
    </div>
  )
}

function Empty({ recent, onOpen }) {
  return (
    <div className="nx-ed-empty">
      <p>Open a file or a folder to start editing.</p>
      {[['Recent files', recent.files], ['Recent folders', recent.folders]].map(([title, list]) => list.length > 0 && (
        <div key={title}>
          <h3>{title}</h3>
          <ul>{list.slice(0, 6).map(p => <li key={p}><button type="button" className="btn sm ghost" title={p} onClick={() => onOpen(p)}>{baseName(p)}</button></li>)}</ul>
        </div>
      ))}
    </div>
  )
}

// Markdown opens rendered, as the Documents app shows it; its source (where editing happens) is a
// click away. Other files have only their source, so no choice.
const viewOf = doc => (languageForPath(doc.name) === 'markdown' ? doc.view ?? 'preview' : null)

function ViewToggle({ doc, view, store }) {
  const option = (value, label) => (
    <button type="button" className={`nx-ed-view${view === value ? ' nx-ed-active' : ''}`} aria-pressed={view === value}
      onClick={() => store.setView(doc.path, value)}>{label}</button>
  )
  return <div role="group" aria-label="Show as" className="nx-ed-views">{option('preview', 'Preview')}{option('source', doc.readOnly ? 'Source' : 'Edit')}</div>
}

const Preview = ({ doc }) => (
  <div className="nx-ed-preview"><MarkdownPreview markdown={doc.text} aria-label={`Preview of ${doc.name}`} className="nx-ed-preview-body" /></div>
)

function DocPane({ doc, store }) {
  if (doc.status === 'loading') return <div className="nx-ed-empty">Loading {doc.name}…</div>
  if (doc.status === 'error') {
    return (
      <div className="nx-ed-empty">
        <p role="alert" className="nx-ed-bad">{doc.error}</p>
        <button type="button" className="btn sm" onClick={() => store.reload(doc.path)}>Try again</button>
      </div>
    )
  }
  const view = viewOf(doc)
  if (doc.readOnly) {
    return (
      <>
        {view === 'preview' ? <Preview doc={doc} /> : <CodeEditor value={doc.text} language={languageForPath(doc.name)} ariaLabel={`Reading ${doc.name}`} readOnly />}
        <div className="nx-ed-status">
          <span className="nx-ed-path" title={doc.origin}>{doc.origin}</span>
          {view && <ViewToggle doc={doc} view={view} store={store} />}
          <span className="nx-ed-readonly">Read-only</span>
        </div>
      </>
    )
  }
  const dirty = isDirty(doc)
  return (
    <>
      {doc.conflict && (
        <div role="alert" className="nx-ed-banner">
          <span>{doc.name} changed on disk since you opened it.</span>
          <button type="button" className="btn sm" onClick={() => store.reload(doc.path)}>Load the disk version</button>
          <button type="button" className="btn sm" onClick={() => store.save(doc.path, { overwrite: true })}>Overwrite it with mine</button>
        </div>
      )}
      {doc.error && <div role="alert" className="nx-ed-banner nx-ed-bad">{doc.error}</div>}
      {view === 'preview' ? <Preview doc={doc} /> : (
        <CodeEditor value={doc.text} language={languageForPath(doc.path)} ariaLabel={`Editing ${doc.name}`} line={doc.line}
          onChange={text => store.setText(doc.path, text)} />
      )}
      <div className="nx-ed-status">
        <span className="nx-ed-path" title={doc.path}>{doc.path}</span>
        {view && <ViewToggle doc={doc} view={view} store={store} />}
        <span>{eolLabel(doc.eol)}{doc.bom ? ' · BOM' : ''}</span>
        <span>{doc.saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
        <button type="button" className="btn sm primary" disabled={!dirty || doc.saving} onClick={() => store.save(doc.path)}>Save</button>
      </div>
    </>
  )
}

// The Editor screen: a folder tree (when a folder is open), tabs, and the active file in CodeEditor.
export function EditorApp({ host, store = editorStore, api = editorApi }) {
  const s = useEditorStore(store)
  const picker = host?.adapters?.picker
  // A tab with unsaved edits waits here for the answer to "discard them?".
  const [closing, setClosing] = React.useState(null)
  const active = s.docs.find(d => d.path === s.active) ?? null

  const openFile = async () => { const r = await picker?.pickFile({ pathOnly: true }); if (r?.path) store.openPath(r.path) }
  const openFolder = async () => { const p = await picker?.pickDirectory(); if (p) store.openFolder(p) }
  const requestClose = doc => (isDirty(doc) ? setClosing(doc.path) : store.close(doc.path))
  const closingDoc = closing ? s.docs.find(d => d.path === closing) : null

  const onKeyDown = e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's' && active) {
      e.preventDefault()
      store.save(active.path)
    }
  }

  return (
    <div className="nx-ed" onKeyDown={onKeyDown}>
      <div className="nx-ed-bar">
        <button type="button" className="btn sm" onClick={openFile}>Open file…</button>
        <button type="button" className="btn sm" onClick={openFolder}>Open folder…</button>
        <select aria-label="Recent" className="nx-ed-recent" value="" onChange={e => e.target.value && store.openPath(e.target.value)}>
          <option value="">Recent…</option>
          {s.recent.files.length > 0 && <optgroup label="Files">{s.recent.files.map(p => <option key={p} value={p}>{baseName(p)} — {p}</option>)}</optgroup>}
          {s.recent.folders.length > 0 && <optgroup label="Folders">{s.recent.folders.map(p => <option key={p} value={p}>{baseName(p)} — {p}</option>)}</optgroup>}
        </select>
      </div>
      {s.notice && (
        <div role="alert" className="nx-ed-banner nx-ed-bad">
          <span>{s.notice}</span>
          <button type="button" className="btn sm ghost" onClick={() => store.dismissNotice()}>Dismiss</button>
        </div>
      )}
      <div className="nx-ed-body">
        {s.folder && (
          <aside className="nx-ed-side">
            <div className="nx-ed-side-head">
              <span title={s.folder}>{baseName(s.folder)}</span>
              <button type="button" className="nx-ed-tab-close" aria-label="Close folder" onClick={() => store.closeFolder()}>×</button>
            </div>
            <FolderTree root={s.folder} api={api} activePath={s.active} onOpenFile={p => store.openFile(p)} />
          </aside>
        )}
        <section className="nx-ed-main">
          {s.docs.length > 0 && (
            <div role="tablist" className="nx-ed-tabs">
              {s.docs.map(d => <Tab key={d.path} doc={d} active={d.path === s.active} onSelect={() => store.activate(d.path)} onClose={() => requestClose(d)} />)}
            </div>
          )}
          {closingDoc && (
            <div role="alert" className="nx-ed-banner">
              <span>Discard your changes to {closingDoc.name}?</span>
              <button type="button" className="btn sm danger" onClick={() => { store.close(closingDoc.path); setClosing(null) }}>Discard</button>
              <button type="button" className="btn sm" onClick={() => setClosing(null)}>Keep editing</button>
            </div>
          )}
          {active ? <DocPane key={active.path} doc={active} store={store} /> : <Empty recent={s.recent} onOpen={p => store.openPath(p)} />}
        </section>
      </div>
    </div>
  )
}
