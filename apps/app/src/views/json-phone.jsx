// json-phone.jsx — the JSON tool on a phone: one focused pane, Edit or Tree. It shares the desktop
// layout's autosave hook and storage key, so saved documents carry over.
import React from 'react';
import { useDocumentAutosave, typeOf } from '@nexusmd/ui';
import { Icon } from '../icons.jsx';
import { toast } from '../toast.jsx';
import { ToolFrame, DocsSheet } from './docs-frame.jsx';
import { JsonNodeSheet } from './json-node-sheet.jsx';
import { searchPaths, pathKey, isContainer } from '../json-tree.js';

const { useState, useMemo, useEffect } = React;
const copy = (text) => (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('Copying is not available here.')))
  .then(() => toast('Copied', 'success'), (e) => toast(`Could not copy. ${e?.message || ''}`.trim(), 'error'));

// Opens the most recently edited saved document on first show, so the tool resumes where it was left.
function useResume(docs, currentDocId, openDoc) {
  useEffect(() => {
    if (currentDocId || !docs.length) return;
    openDoc([...docs].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── JSON ──────────────────────────────────────────────────────────────────────
const SAMPLE_TEXT = JSON.stringify({
  name: 'Alice Johnson', age: 28, active: true, role: null,
  address: { street: '12 Oak Avenue', city: 'Bristol', postcode: 'BS1 4QX' },
  tags: ['developer', 'designer', 'mentor'], score: 94.5,
}, null, 2);

// A saved document's name: a top-level "name"/"title" string if there is one, else a snippet.
export function jsonAutoName(text) {
  try {
    const p = JSON.parse(text);
    if (p && typeof p === 'object' && !Array.isArray(p)) {
      const n = p.name ?? p.title;
      if (typeof n === 'string' && n.trim()) return n.trim().slice(0, 80);
    }
  } catch { /* fall through to the snippet */ }
  const s = text.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, 60) : 'Untitled';
}

export function parseJson(text) {
  try { return { ok: true, value: JSON.parse(text) }; } catch (e) { return { ok: false, message: e.message }; }
}

const preview = (v) => {
  const t = typeOf(v);
  return t === 'object' ? `{ ${Object.keys(v).length} }` : t === 'array' ? `[ ${v.length} ]` : t === 'string' ? JSON.stringify(v) : String(v);
};

// One row of the tree. The caret opens and closes a group or list; tapping the row edits it. While
// searching, only matching rows and the groups above them are shown, all opened.
function TreeNode({ k, v, depth, path, flipped, flip, onEdit, search }) {
  const t = typeOf(v);
  const container = isContainer(v);
  const id = pathKey(path);
  if (search.active && !search.show.has(id)) return null;
  const open = container && (search.active ? true : (depth < 2) !== flipped.has(id));
  return (
    <div className="m-tree-node">
      <div className="m-tree-row">
        {container
          ? <button type="button" className="m-tree-caret tap" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={() => flip(id)}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={14}/></button>
          : <span className="m-tree-caret"/>}
        <button type="button" className="m-tree-body" onClick={() => onEdit(path)} aria-label={k == null ? 'Edit the whole document' : `Edit ${k}`}>
          {k != null && <span className="m-tree-key">{k}</span>}
          <span className={`m-tree-val ${t}`}>{preview(v)}</span>
        </button>
      </div>
      {open && (
        <div className="m-tree-kids">
          {(t === 'array' ? v.map((x, i) => [i, x]) : Object.entries(v)).map(([ck, cv]) => (
            <TreeNode key={ck} k={ck} v={cv} depth={depth + 1} path={[...path, ck]} flipped={flipped} flip={flip} onEdit={onEdit} search={search}/>
          ))}
        </div>
      )}
    </div>
  );
}

export function JsonPhone({ tool, setTool, onFlash }) {
  const d = useDocumentAutosave({
    storageKey: 'json_editor_documents', initialContent: SAMPLE_TEXT, emptyContent: '{}',
    isEmpty: t => !t.trim(), extractAutoName: jsonAutoName,
  });
  useResume(d.docs, d.currentDocId, d.openDoc);
  const [mode, setMode] = useState('edit');
  const [sheet, setSheet] = useState(false);
  const [flipped, setFlipped] = useState(() => new Set());
  const [editPath, setEditPath] = useState(null);
  const [term, setTerm] = useState('');
  const parsed = useMemo(() => parseJson(d.content), [d.content]);
  const flip = (p) => setFlipped(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const current = d.docs.find(x => x.id === d.currentDocId);
  const title = current ? (current.name ?? current.autoName) : 'New document';

  const search = useMemo(() => (parsed.ok ? searchPaths(parsed.value, term) : { show: new Set(), count: 0, active: false }), [parsed, term]);
  // An edit rewrites the document; Undo puts the text back as it was.
  const applyEdit = (next, message) => {
    const before = d.content;
    d.setContent(JSON.stringify(next, null, 2));
    onFlash?.(message, 'check', () => d.setContent(before));
  };
  const act = (fn) => { if (parsed.ok) d.setContent(fn(parsed.value)); };
  const status = d.saveStatus === 'saving' ? 'Saving…' : d.saveStatus === 'saved' ? 'Saved' : '';

  return (
    <>
      <ToolFrame sub={title} tool={tool} setTool={setTool} onDocs={() => setSheet(true)} onNew={() => { d.newDoc(); setMode('edit'); }}
        footer={(
          <div className="m-docs-foot">
            <span className={`m-json-state ${parsed.ok ? 'ok' : 'bad'}`}>{parsed.ok ? 'Valid JSON' : 'Invalid JSON'}</span>
            <span className="m-docs-status">{status}</span>
          </div>
        )}>
        <div className="m-seg" style={{ margin: '0 0 10px' }}>
          <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>Edit</button>
          <button type="button" className={mode === 'tree' ? 'active' : ''} onClick={() => setMode('tree')}>Tree</button>
        </div>
        {mode === 'edit' ? (
          <>
            <div className="m-docs-chips">
              <button type="button" className="m-chip" disabled={!parsed.ok} onClick={() => act(v => JSON.stringify(v, null, 2))}>Format</button>
              <button type="button" className="m-chip" disabled={!parsed.ok} onClick={() => act(v => JSON.stringify(v))}>Minify</button>
              <button type="button" className="m-chip" onClick={() => { copy(d.content); onFlash?.('Copied'); }}>Copy</button>
            </div>
            <textarea className="m-docs-text" value={d.content} onChange={e => d.setContent(e.target.value)}
              spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="JSON"/>
            {!parsed.ok && d.content.trim() && <div className="m-error" role="alert">{parsed.message}</div>}
          </>
        ) : (
          <>
            <div className="m-search" style={{ marginBottom: 10 }}>
              <span className="si"><Icon name="search" size={16}/></span>
              <input type="search" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search names and values" aria-label="Search the tree" disabled={!parsed.ok}/>
            </div>
            {search.active && <div className="m-hint" style={{ marginTop: -4, marginBottom: 8 }}>{search.count} match{search.count === 1 ? '' : 'es'}</div>}
            <div className="m-docs-preview">
              {parsed.ok
                ? (search.active && search.count === 0
                    ? <div className="muted">Nothing matches “{term}”.</div>
                    : <TreeNode k={null} v={parsed.value} depth={0} path={[]} flipped={flipped} flip={flip} onEdit={setEditPath} search={search}/>)
                : <div className="m-error" role="alert">Fix the JSON to see the tree. {parsed.message}</div>}
            </div>
          </>
        )}
      </ToolFrame>
      {parsed.ok && <JsonNodeSheet data={parsed.value} path={editPath} onClose={() => setEditPath(null)} onApply={applyEdit}/>}
      <DocsSheet open={sheet} onClose={() => setSheet(false)} docs={d.docs} currentDocId={d.currentDocId} name="JSON documents"
        onOpen={(id) => { d.openDoc(id); setMode('edit'); }} onNew={() => { d.newDoc(); setMode('edit'); }} onRename={d.renameDoc} onDelete={d.deleteDoc}/>
    </>
  );
}
