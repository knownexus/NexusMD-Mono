// view-notes.jsx — Notes on a phone: a list (tick to complete), then a full-screen editor with
// Edit / Preview, autosave and a bottom bar to make a work item or task. Notes can be marked
// confidential: they use the planner's confidential password, show their title but hide the body
// while locked, and lock again after a stretch of inactivity.
import React from 'react';
import {
  loadGlobalNotes, saveGlobalNotes, plMdToHtml,
  loadConfidentialConfig, ConfidentialUnlockModal, ConfidentialSetPasswordModal, saveConfidentialConfig,
} from '@nexusmd/ui';
import { Icon } from '../icons.jsx';
import { getYearWeekForOffset } from '@nexusmd/core';

const { useState, useEffect, useRef, useCallback } = React;

const LOCK_AFTER_MS = 5 * 60 * 1000;
const snippet = (body) => (body || '').replace(/[#>*`\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 110);
const titleOf = (n) => (n.title || snippet(n.body)).slice(0, 160);

function NoteEditor({ note, unlocked, weekLabel, onPatch, onBack, onDelete, onAddTask, onToggleLock }) {
  const [preview, setPreview] = useState(false);
  const hidden = note.confidential && !unlocked;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="m-appbar">
        <button type="button" className="m-iconbtn" aria-label="Back" onClick={onBack}><Icon name="chevron-left" size={18}/></button>
        <div className="m-ab-lead">
          <input className="m-note-title" value={note.title} placeholder="Note title…"
            onChange={e => onPatch({ title: e.target.value })}/>
        </div>
        <div className="m-ab-actions">
          <button type="button" className={`m-iconbtn${note.confidential ? ' active' : ''}`}
            title={note.confidential ? 'Remove confidential' : 'Make confidential'} onClick={onToggleLock}>
            <Icon name="lock" size={17}/>
          </button>
          <button type="button" className="m-iconbtn" title="Delete note" onClick={onDelete}><Icon name="trash" size={17}/></button>
        </div>
      </div>
      <div className="m-screen" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {note.confidential && (
          <div className="m-confnote"><Icon name="lock" size={13}/> Confidential. Hidden when notes lock.</div>
        )}
        {hidden ? (
          <div className="m-empty"><div className="et">Locked</div><div className="es">Unlock confidential notes to read this one.</div></div>
        ) : (
          <>
            <div className="m-seg" style={{ marginBottom: 10 }}>
              <button type="button" className={!preview ? 'active' : ''} onClick={() => setPreview(false)}>Edit</button>
              <button type="button" className={preview ? 'active' : ''} onClick={() => setPreview(true)}>Preview</button>
            </div>
            {preview ? (
              <div className="wi-html-content m-note-body"
                dangerouslySetInnerHTML={{ __html: (note.body || '').trim() ? plMdToHtml(note.body) : '<em>Nothing to preview yet.</em>' }}/>
            ) : (
              <textarea className="m-note-body m-note-text" value={note.body || ''} autoFocus
                placeholder={'# Notes\n\n- Decision: …'}
                onChange={e => onPatch({ body: e.target.value })}/>
            )}
          </>
        )}
      </div>
      <div className="m-notebar">
        <button type="button" className="btn ghost m-btn-lg" disabled={hidden}
          onClick={() => window.dispatchEvent(new CustomEvent('helm:create-wi', { detail: { title: titleOf(note) } }))}>
          <Icon name="work" size={14}/> Work item
        </button>
        <button type="button" className="btn ghost m-btn-lg" disabled={hidden} onClick={() => onAddTask(titleOf(note))}>
          <Icon name="check-circle" size={14}/> Task in {weekLabel}
        </button>
      </div>
    </div>
  );
}

export function NotesView({ onAddTask, onFlash }) {
  const [notes, setNotesRaw] = useState(() => loadGlobalNotes());
  const [openId, setOpenId] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [modal, setModal] = useState(null); // 'unlock' | 'setpw'
  const [pendingLock, setPendingLock] = useState(null);
  const idleTimer = useRef(null);

  const { week } = getYearWeekForOffset(0);
  const weekLabel = `W${week}`;

  const setNotes = useCallback((fn) => setNotesRaw(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn;
    saveGlobalNotes(next);
    return next;
  }), []);
  const patch = (id, p) => setNotes(ns => ns.map(n => (n.id === id ? { ...n, ...p, updatedAt: new Date().toISOString() } : n)));

  // One unlock opens every confidential note; it lapses after LOCK_AFTER_MS without activity.
  const touch = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setUnlocked(false), LOCK_AFTER_MS);
  }, []);
  useEffect(() => { if (unlocked) touch(); return () => clearTimeout(idleTimer.current); }, [unlocked, touch, notes]);

  const create = () => {
    const n = { id: 'gn' + Date.now(), title: '', body: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'open', completedWeek: null };
    setNotes(ns => [n, ...ns]);
    setOpenId(n.id);
  };
  const remove = (id) => { setNotes(ns => ns.filter(n => n.id !== id)); setOpenId(null); };

  const toggleLock = (note) => {
    // A locked note can't be un-protected without the password.
    if (note.confidential) return unlocked ? patch(note.id, { confidential: false }) : setModal('unlock');
    if (!loadConfidentialConfig().hash) { setPendingLock(note.id); return setModal('setpw'); }
    patch(note.id, { confidential: true });
  };

  const open = notes.filter(n => n.status !== 'done');
  const done = notes.filter(n => n.status === 'done');
  const current = notes.find(n => n.id === openId);
  const anyLocked = !unlocked && notes.some(n => n.confidential);

  const modals = (
    <>
      <ConfidentialUnlockModal open={modal === 'unlock'} onClose={() => setModal(null)}
        onUnlocked={() => { setUnlocked(true); setModal(null); }}/>
      <ConfidentialSetPasswordModal open={modal === 'setpw'} existingHash={null}
        onClose={() => { setModal(null); setPendingLock(null); }}
        onSaved={(hash) => {
          const cfg = { ...loadConfidentialConfig(), hash };
          saveConfidentialConfig(cfg);
          if (pendingLock) patch(pendingLock, { confidential: true });
          setPendingLock(null); setModal(null); setUnlocked(true);
        }}/>
    </>
  );

  if (current) {
    return (
      <>
        <NoteEditor note={current} unlocked={unlocked} weekLabel={weekLabel}
          onPatch={(p) => patch(current.id, p)} onBack={() => setOpenId(null)}
          onDelete={() => (current.confidential && !unlocked ? setModal('unlock') : remove(current.id))} onToggleLock={() => toggleLock(current)}
          onAddTask={(t) => { onAddTask?.(t); onFlash?.(`Added as a task in ${weekLabel}`); }}/>
        {modals}
      </>
    );
  }

  const row = (n) => {
    const hidden = n.confidential && !unlocked;
    return (
      <div key={n.id} className="m-row" onClick={() => setOpenId(n.id)}>
        <button type="button" className={`m-check${n.status === 'done' ? ' on' : ''}`}
          aria-label={n.status === 'done' ? 'Reopen' : 'Mark complete'}
          onClick={e => { e.stopPropagation(); patch(n.id, n.status === 'done' ? { status: 'open', completedWeek: null } : { status: 'done', completedWeek: weekLabel }); }}>
          <Icon name="check" size={12}/>
        </button>
        <div className="m-row-main">
          <div className="m-row-title">{n.title || <em style={{ color: 'var(--text-subtle)' }}>Untitled note</em>}</div>
          {!hidden && snippet(n.body) && <div className="m-row-sub">{snippet(n.body)}</div>}
          {hidden && <div className="m-row-sub">Confidential</div>}
        </div>
        {n.confidential && <Icon name="lock" size={14} className="chev"/>}
        <Icon name="chevron-right" size={16} className="chev"/>
      </div>
    );
  };

  return (
    <>
      <div className="m-appbar">
        <div className="m-ab-lead"><div><h1>Notes</h1><div className="m-ab-sub">Week-agnostic · this week is {weekLabel}</div></div></div>
        <div className="m-ab-actions">
          {anyLocked && <button type="button" className="m-linkbtn" onClick={() => setModal('unlock')}>Unlock</button>}
        </div>
      </div>
      <div className="m-screen" style={{ paddingBottom: 80 }}>
        {open.length === 0
          ? <div className="m-empty"><div className="et">No open notes</div><div className="es">Tap + to write one.</div></div>
          : <div className="m-card flush">{open.map(row)}</div>}
        {done.length > 0 && (
          <>
            <div className="m-sec-h" onClick={() => setShowDone(s => !s)} style={{ cursor: 'pointer' }}>
              <span className="lbl">Completed</span><span className="line"/><span className="cnt">{done.length}</span>
            </div>
            {showDone && <div className="m-card flush">{done.map(row)}</div>}
          </>
        )}
      </div>
      <button type="button" className="m-fab" onClick={create} aria-label="New note"><Icon name="plus" size={24}/></button>
      {modals}
    </>
  );
}
