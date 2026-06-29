import React from 'react';
import { PlModal } from '../planner-chips.jsx';
import { Icon } from '../icons.jsx';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useNexusData } from '../data-context.jsx';
import { getPlannerRuntime } from './runtime.js';
// planner-notes.jsx — Planner v2 markdown notes: multi-notes per row + week-agnostic notes library.
// Shared web + app. The "create work item" event name and the global-notes storage key
// are namespaced via the data-context / planner runtime (web 'nexusmd', app 'helm').
const { useState: useStatePN, useEffect: useEffectPN } = React;

// ── Markdown ──────────────────────────────────────────────────
const _plEsc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function plMdToHtml(text) {
  if (!text) return '';
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined')
    return '<pre style="white-space:pre-wrap">' + _plEsc(text) + '</pre>';
  return DOMPurify.sanitize(marked.parse(text), { USE_PROFILES: { html: true } });
}

// Normalize a row's notes to a list. Migrates legacy single `_notes` string
// (the pre-v2 meetNotes format) into a one-item list, non-destructively.
export function plRowNotes(row) {
  if (Array.isArray(row._notesList)) return row._notesList;
  if ((row._notes || '').trim()) {
    return [{ id: 'mig0', title: 'Notes', body: row._notes, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  }
  return [];
}

// ── "Create work item" context layer ──────────────────────────
// plOpenCtx(event, fallbackText) — selection wins over fallback.
// The menu dispatches the app's existing `helm:create-wi` event, which opens
// the real work-item creation dialog (same as the old right-click flow).
export function plOpenCtx(e, fallbackText) {
  const sel = window.getSelection()?.toString().trim();
  const text = sel || (fallbackText || '').trim();
  if (!text) return;
  e.preventDefault();
  window.dispatchEvent(new CustomEvent('pl:ctx', { detail: { x: e.clientX, y: e.clientY, text } }));
}

export function WorkItemCtxLayer() {
  const { namespace } = useNexusData();
  const [menu, setMenu] = useStatePN(null);
  useEffectPN(() => {
    const onOpen = e => setMenu(e.detail);
    const onClose = () => setMenu(null);
    const onKey = e => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('pl:ctx', onOpen);
    document.addEventListener('mousedown', onClose);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pl:ctx', onOpen);
      document.removeEventListener('mousedown', onClose);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 230);
  const y = Math.min(menu.y, window.innerHeight - 90);
  return (
    <div onMouseDown={e => e.stopPropagation()} style={{
      position: 'fixed', left: x, top: y, zIndex: 9999, minWidth: 210,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 10, boxShadow: 'var(--shadow-pop)', padding: 4,
    }}>
      <div style={{ padding: '4px 10px 5px', fontSize: 10.5, color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)', marginBottom: 3, maxWidth: 270, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        “{menu.text.slice(0, 60)}{menu.text.length > 60 ? '…' : ''}”
      </div>
      <button
        onClick={() => {
          window.dispatchEvent(new CustomEvent(`${namespace}:create-wi`, { detail: { title: menu.text.slice(0, 160) } }));
          setMenu(null);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 6,
          width: '100%', textAlign: 'left', background: 'transparent', border: 0, cursor: 'pointer',
          color: 'var(--text)', fontSize: 13, fontFamily: 'var(--sans)',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <Icon name="plus" size={12}/> Create work item
      </button>
    </div>
  );
}

// ── Edit / Preview markdown editor ────────────────────────────
export function NotesEditor({ value, onChange }) {
  const [preview, setPreview] = useStatePN(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Markdown supported — # headings, **bold**, - lists, `code`
        </span>
        <div className="pl-seg">
          <button className={!preview ? 'active' : ''} onClick={() => setPreview(false)}><Icon name="edit" size={11}/>Edit</button>
          <button className={preview ? 'active' : ''} onClick={() => setPreview(true)}><Icon name="eye" size={11}/>Preview</button>
        </div>
      </div>
      {preview ? (
        <div className="wi-html-content"
          style={{ minHeight: '46vh', fontSize: 13, lineHeight: 1.6, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', overflowY: 'auto', color: value.trim() ? 'var(--text)' : 'var(--text-subtle)' }}
          dangerouslySetInnerHTML={{ __html: value.trim() ? plMdToHtml(value) : '<em>Nothing to preview yet.</em>' }}></div>
      ) : (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onContextMenu={e => plOpenCtx(e, '')}
          autoFocus
          placeholder={'# Notes\n\n- Decision: …\n- **Action:** owner / date'}
          style={{
            width: '100%', boxSizing: 'border-box', minHeight: '46vh', resize: 'vertical',
            border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)',
            font: 'inherit', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.6,
            color: 'var(--text)', outline: 'none', padding: '10px 12px',
          }}/>
      )}
    </div>
  );
}

// ── Multi-note modal: list (left) + editor (right) ────────────
export function RowNotesModal({ open, onClose, title, sub, notes, onChange }) {
  const [selId, setSelId] = useStatePN(null);
  useEffectPN(() => { if (open) setSelId(notes.length ? notes[0].id : null); }, [open]);
  if (!open) return null;

  const sel = notes.find(n => n.id === selId) || null;
  const patch = (id, p) => onChange(notes.map(n => n.id === id ? { ...n, ...p, updatedAt: new Date().toISOString() } : n));
  const addNote = () => {
    const n = { id: 'rn' + Date.now(), title: '', body: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    onChange([...notes, n]);
    setSelId(n.id);
  };
  const removeNote = (id) => {
    const next = notes.filter(n => n.id !== id);
    onChange(next);
    if (selId === id) setSelId(next.length ? next[0].id : null);
  };

  return (
    <PlModal open={open} onClose={onClose} icon="edit" wide className="notes-modal"
      title={title} sub={sub}
      footerLeft="Saved as you type"
      footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="rn-layout">
        <div className="rn-list">
          {notes.map(n => (
            <div key={n.id} className={`rn-item ${n.id === selId ? 'active' : ''}`} onClick={() => setSelId(n.id)}>
              <div className="rn-ttl">{n.title || <span style={{ fontStyle: 'italic', opacity: .6 }}>Untitled</span>}</div>
              <div className="rn-date">{new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
              <button className="btn icon ghost sm rn-del" title="Delete note"
                onClick={e => { e.stopPropagation(); removeNote(n.id); }}>
                <Icon name="trash" size={11}/>
              </button>
            </div>
          ))}
          <button className="rn-add" onClick={addNote}><Icon name="plus" size={12}/> New note</button>
        </div>
        <div className="rn-editor">
          {sel ? (
            <React.Fragment>
              <input
                value={sel.title}
                onChange={e => patch(sel.id, { title: e.target.value })}
                placeholder="Note title… (e.g. Decisions, Risks, Follow-ups)"
                style={{
                  width: '100%', boxSizing: 'border-box', border: 0, outline: 'none', background: 'transparent',
                  font: 'inherit', fontSize: 15.5, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)', padding: '0 0 6px',
                }}/>
              <NotesEditor value={sel.body || ''} onChange={v => patch(sel.id, { body: v })}/>
            </React.Fragment>
          ) : (
            <div className="empty" style={{ padding: '60px 20px', fontSize: 12.5 }}>
              No notes yet for this entry.<br/><br/>
              <button className="btn sm primary" onClick={addNote}><Icon name="plus" size={12}/> Add the first note</button>
            </div>
          )}
        </div>
      </div>
    </PlModal>
  );
}

// Small labeled trigger used in table rows / drawers
export function NotesButton({ hasNotes, count, onClick, compact }) {
  return (
    <button className={`btn sm ghost notes-btn ${hasNotes ? 'has' : ''}`}
      title={hasNotes ? 'View / edit notes' : 'Add notes'}
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        color: hasNotes ? 'var(--accent)' : 'var(--text-subtle)',
        fontWeight: hasNotes ? 600 : 400,
        background: hasNotes ? 'var(--accent-soft)' : undefined,
        border: hasNotes ? '1px solid var(--accent-border)' : undefined,
        flexShrink: 0,
      }}>
      <Icon name="edit" size={11}/>
      {compact ? null : hasNotes ? `Notes${count > 1 ? ' · ' + count : ''}` : 'Add notes'}
    </button>
  );
}

// ── Week-agnostic notes library ───────────────────────────────
// Stored under `${namespace}.planner.globalNotes`, synced via the host's pushPref.
// Plain functions (not components) so they read the planner runtime, which the
// NexusDataProvider mirrors from its value.
function globalNotesKey() {
  const { getProfileKey, namespace } = getPlannerRuntime();
  return getProfileKey(`${namespace}.planner.globalNotes`);
}
export function loadGlobalNotes() {
  const { storage } = getPlannerRuntime();
  try {
    const raw = storage.getItem(globalNotesKey());
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}
export function saveGlobalNotes(notes) {
  const { storage, namespace, pushPref } = getPlannerRuntime();
  const key = globalNotesKey();
  const s = JSON.stringify(notes);
  try { storage.setItem(key, s); } catch {}
  pushPref?.(`${namespace}.planner.globalNotes`, s);
  // Signal the cloud-sync change trigger (web). No-op where nothing listens.
  try { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('nexusmd:data-changed', { detail: { collId: 'notes' } })); } catch {}
}
function noteSnippet(body) {
  return (body || '').replace(/[#>*`\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 110);
}

export function GlobalNoteModal({ note, onClose, onPatch, onDelete, weekLabel, onAddTask }) {
  const { namespace } = useNexusData();
  if (!note) return null;
  const done = note.status === 'done';
  return (
    <PlModal open={!!note} onClose={onClose} icon="pin" wide className="notes-modal"
      title="Note" sub={done ? `Completed in ${note.completedWeek}` : 'Week-agnostic · saved as you type'}
      footerLeft={
        <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={() => { onDelete(note.id); onClose(); }}>
          <Icon name="trash" size={12}/> Delete
        </button>
      }
      footer={(
        <React.Fragment>
          <button className="btn sm ghost" title="Open the work-item dialog for this note"
            onClick={() => window.dispatchEvent(new CustomEvent(`${namespace}:create-wi`, { detail: { title: (note.title || noteSnippet(note.body)).slice(0, 160) } }))}>
            <Icon name="work" size={12}/> Work item
          </button>
          {onAddTask && (
            <button className="btn sm ghost" title={`Add as a task in ${weekLabel}`}
              onClick={() => onAddTask((note.title || noteSnippet(note.body)).slice(0, 160))}>
              <Icon name="check-circle" size={12}/> Task this week
            </button>
          )}
          {done ? (
            <button className="btn sm" onClick={() => onPatch(note.id, { status: 'open', completedWeek: null })}>Reopen</button>
          ) : (
            <button className="btn sm" onClick={() => onPatch(note.id, { status: 'done', completedWeek: weekLabel })}>
              <Icon name="check" size={12}/> Complete in {weekLabel}
            </button>
          )}
          <button className="btn primary" onClick={onClose}>Done</button>
        </React.Fragment>
      )}>
      <input
        value={note.title}
        onChange={e => onPatch(note.id, { title: e.target.value })}
        placeholder="Note title…"
        style={{
          width: '100%', boxSizing: 'border-box', border: 0, outline: 'none', background: 'transparent',
          font: 'inherit', fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)', padding: '0 0 2px',
        }}/>
      <NotesEditor value={note.body || ''} onChange={v => onPatch(note.id, { body: v, updatedAt: new Date().toISOString() })}/>
    </PlModal>
  );
}

export function GlobalNotesView({ notes, setNotes, weekLabel, onAddTask }) {
  const [openId, setOpenId] = useStatePN(null);
  const [showDone, setShowDone] = useStatePN(false);
  const open = notes.filter(n => n.status !== 'done');
  const done = notes.filter(n => n.status === 'done');
  const openNote = notes.find(n => n.id === openId) || null;

  const patch = (id, p) => setNotes(ns => ns.map(n => n.id === id ? { ...n, ...p } : n));
  const remove = (id) => setNotes(ns => ns.filter(n => n.id !== id));
  const create = () => {
    const n = { id: 'gn' + Date.now(), title: '', body: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'open', completedWeek: null };
    setNotes(ns => [n, ...ns]);
    setOpenId(n.id);
  };

  const card = (n) => (
    <div key={n.id} className="gnote-card" onClick={() => setOpenId(n.id)}
      onContextMenu={e => plOpenCtx(e, n.title || noteSnippet(n.body))}>
      <span className={`check ${n.status === 'done' ? 'on' : ''}`}
        title={n.status === 'done' ? `Completed in ${n.completedWeek} — click to reopen` : `Mark complete in ${weekLabel}`}
        onClick={e => {
          e.stopPropagation();
          patch(n.id, n.status === 'done' ? { status: 'open', completedWeek: null } : { status: 'done', completedWeek: weekLabel });
        }}>
        <Icon name="check" size={11}/>
      </span>
      <div className="body">
        <div className="ttl">{n.title || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Untitled note</span>}</div>
        {noteSnippet(n.body) && <div className="snip">{noteSnippet(n.body)}</div>}
        <div className="meta">
          <span>Updated {new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          {n.status === 'done' && <span className="pill success">done · {n.completedWeek}</span>}
        </div>
      </div>
      <Icon name="chevron-right" size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }}/>
    </div>
  );

  return (
    <div data-screen-label="Notes library">
      <div className="card pl-section">
        <div className="card-head">
          <h3>
            <span className="ic"><Icon name="pin" size={14}/></span>
            Notes
            <span className="pl-sec-count">{open.length} open · week-agnostic</span>
          </h3>
          <div className="actions">
            <button className="btn sm primary" onClick={create}><Icon name="plus" size={12}/> New note</button>
          </div>
        </div>
        <div className="card-body flush">
          <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-subtle)', borderBottom: '1px solid var(--border)' }}>
            These notes live outside the weekly cycle. Tick one to mark it complete in <strong>{weekLabel}</strong>; right-click any note to create a work item.
          </div>
          {open.length === 0 && <div className="empty" style={{ padding: '28px 20px', fontSize: 12.5 }}>No open notes — create one above.</div>}
          {open.map(card)}
        </div>
      </div>

      {done.length > 0 && (
        <div className="card pl-section">
          <div className="card-head" style={{ cursor: 'pointer' }} onClick={() => setShowDone(s => !s)}>
            <h3>
              <span className="ic"><Icon name="check-circle" size={14}/></span>
              Completed
              <span className="pl-sec-count">{done.length}</span>
            </h3>
            <div className="actions"><Icon name={showDone ? 'chevron-up' : 'chevron-down'} size={14} style={{ color: 'var(--text-subtle)' }}/></div>
          </div>
          {showDone && <div className="card-body flush">{done.map(card)}</div>}
        </div>
      )}

      <GlobalNoteModal note={openNote} onClose={() => setOpenId(null)} onPatch={patch} onDelete={remove} weekLabel={weekLabel} onAddTask={onAddTask}/>
    </div>
  );
}

