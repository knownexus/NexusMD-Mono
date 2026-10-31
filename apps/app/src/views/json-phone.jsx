// json-phone.jsx — the JSON tool on a phone: one focused pane, Edit or Tree. It shares the desktop
// layout's autosave hook and storage key, so saved documents carry over.
import React from 'react';
import { useDocumentAutosave, typeOf } from '@nexusmd/ui';
import { Icon } from '../icons.jsx';
import { ToolFrame, DocsSheet } from './docs-frame.jsx';

const { useState, useMemo, useEffect } = React;
const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

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

function TreeNode({ k, v, depth, path, flipped, flip }) {
  const t = typeOf(v);
  const container = t === 'object' || t === 'array';
  const open = container && (depth < 2) !== flipped.has(path);
  return (
    <div className="m-tree-node">
      <div className={`m-tree-row${container ? ' tap' : ''}`} onClick={container ? () => flip(path) : undefined}>
        <span className="m-tree-caret">{container ? <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13}/> : null}</span>
        {k != null && <span className="m-tree-key">{k}</span>}
        <span className={`m-tree-val ${t}`}>{preview(v)}</span>
      </div>
      {open && (
        <div className="m-tree-kids">
          {(t === 'array' ? v.map((x, i) => [i, x]) : Object.entries(v)).map(([ck, cv]) => (
            <TreeNode key={ck} k={ck} v={cv} depth={depth + 1} path={`${path}/${ck}`} flipped={flipped} flip={flip}/>
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
  const parsed = useMemo(() => parseJson(d.content), [d.content]);
  const flip = (p) => setFlipped(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const current = d.docs.find(x => x.id === d.currentDocId);
  const title = current ? (current.name ?? current.autoName) : 'New document';

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
          <div className="m-docs-preview">
            {parsed.ok
              ? <TreeNode k={null} v={parsed.value} depth={0} path="" flipped={flipped} flip={flip}/>
              : <div className="m-error" role="alert">Fix the JSON to see the tree. {parsed.message}</div>}
          </div>
        )}
      </ToolFrame>
      <DocsSheet open={sheet} onClose={() => setSheet(false)} docs={d.docs} currentDocId={d.currentDocId} name="JSON documents"
        onOpen={(id) => { d.openDoc(id); setMode('edit'); }} onNew={() => { d.newDoc(); setMode('edit'); }} onRename={d.renameDoc} onDelete={d.deleteDoc}/>
    </>
  );
}
