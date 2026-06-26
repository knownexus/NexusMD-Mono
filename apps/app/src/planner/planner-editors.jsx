import React from 'react';
import { PL_OPEN, StatusChip, PrioChip, PlFld, ColInput, DueLabel, qaParse, plNewRow } from './planner-ui.jsx';
import { RowNotesModal, NotesButton } from './planner-notes.jsx';
import { Icon } from '../icons.jsx';
// planner-editors.jsx — Planner v2 section editors: three entry styles, row-level
// confidential locks, multi-notes, drag reorder, row highlight, meeting select dropdown.
// Requires planner-ui.jsx + planner-notes.jsx.
const { useState: useStatePE, useRef: useRefPE, useEffect: useEffectPE } = React;

// ── Shared row-action fragments ───────────────────────────────
function LockRowControls({ row, sessionUnlocked, onLockRow, onUnlockRow }) {
  const isConf = !!row._confidential;
  if (isConf && sessionUnlocked) return (
    <button className="btn icon ghost sm" title="Remove lock from this entry"
      style={{ color: 'var(--accent)' }} onClick={e => { e.stopPropagation(); onUnlockRow && onUnlockRow(row.id); }}>
      <Icon name="lock" size={11}/>
    </button>
  );
  if (isConf) return (
    <span style={{ display: 'inline-flex', padding: '0 3px', opacity: 0.25 }}><Icon name="lock" size={11}/></span>
  );
  return (
    <button className="btn icon ghost sm" title="Lock this entry as confidential"
      style={{ opacity: 0.25, transition: 'opacity 0.15s' }}
      onMouseEnter={e => e.currentTarget.style.opacity = '1'}
      onMouseLeave={e => e.currentTarget.style.opacity = '0.25'}
      onClick={e => { e.stopPropagation(); onLockRow && onLockRow(row.id); }}>
      <Icon name="lock" size={11}/>
    </button>
  );
}

function HintControl({ row, onUpdate }) {
  const [open, setOpen] = useStatePE(false);
  const ref = useRefPE(null);
  const inputRef = useRefPE(null);
  useEffectPE(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 0);
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const has = !!(row._hint || '').trim();
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="btn icon ghost sm"
        title={has ? `Hint: ${row._hint}` : 'Add hint (shown when locked)'}
        style={{ color: has ? 'var(--accent)' : undefined, opacity: has ? 1 : 0.25, transition: 'opacity 0.15s' }}
        onMouseEnter={e => { if (!has) e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={e => { if (!has) e.currentTarget.style.opacity = '0.25'; }}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        <Icon name="tag" size={11}/>
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10,
          padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column', gap: 8, minWidth: 240 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-subtle)' }}>Shown when locked</div>
          <input ref={inputRef} type="text" className="plf-input" value={row._hint || ''}
            placeholder="e.g. re: performance review"
            onChange={e => onUpdate(e.target.value || undefined)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setOpen(false); }}
            style={{ fontSize: 12.5 }}/>
        </div>
      )}
    </span>
  );
}

function ReminderControl({ row, onUpdate }) {
  const [open, setOpen] = useStatePE(false);
  const ref = useRefPE(null);
  useEffectPE(() => {
    if (!open) return;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const today = new Date().toISOString().slice(0, 10);
  const has = !!row._reminderDate;
  const overdue = has && row._reminderDate < today;
  const dueToday = has && row._reminderDate === today;
  const toneColor = overdue ? 'var(--danger)' : dueToday ? 'oklch(0.72 0.14 70)' : has ? 'var(--accent)' : null;
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="btn icon ghost sm"
        title={has ? `Reminder: ${row._reminderDate}` : 'Set reminder'}
        style={{ color: toneColor || undefined, opacity: has ? 1 : 0.25, transition: 'opacity 0.15s' }}
        onMouseEnter={e => { if (!has) e.currentTarget.style.opacity = '1'; }}
        onMouseLeave={e => { if (!has) e.currentTarget.style.opacity = '0.25'; }}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        <Icon name="bell" size={11}/>
      </button>
      {open && (
        <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10,
          padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column', gap: 8, minWidth: 190 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-subtle)' }}>Remind me on</div>
          <input type="date" className="plf-input" value={row._reminderDate || ''}
            onChange={e => { onUpdate(e.target.value || null); if (e.target.value) setOpen(false); }}
            style={{ fontSize: 12.5 }}/>
          {has && (
            <button className="btn sm ghost" style={{ color: 'var(--danger)', fontSize: 11, alignSelf: 'flex-start', padding: '2px 8px' }}
              onClick={() => { onUpdate(null); setOpen(false); }}>
              Clear reminder
            </button>
          )}
        </div>
      )}
    </span>
  );
}

function LockedRowNotice({ onUnlockRequest, reminderDate, hint }) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = reminderDate && reminderDate <= today;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-subtle)', fontStyle: 'italic' }}>
      <Icon name="lock" size={12}/>
      {hint
        ? <span style={{ color: 'var(--text)', fontStyle: 'normal', fontWeight: 500 }}>{hint}</span>
        : 'Confidential entry'}
      {reminderDate && (
        <span className="pill" style={{ fontStyle: 'normal', color: overdue ? 'var(--danger)' : 'var(--accent)' }}>
          <Icon name="bell" size={9}/>&nbsp;{overdue ? 'Reminder overdue' : `Reminder ${reminderDate}`}
        </span>
      )}
      {onUnlockRequest && (
        <button className="btn sm ghost" style={{ fontSize: 11, fontStyle: 'normal', padding: '1px 8px' }}
          onClick={e => { e.stopPropagation(); onUnlockRequest(); }}>
          Unlock to view
        </button>
      )}
    </span>
  );
}

// ── Variant A: refined inline table ──────────────────────────
function InlineTable({ section, rows, setRows, sessionUnlocked, onUnlockRequest, onLockRow, onUnlockRow, highlightedRowId, meetingOptions }) {
  const [dragId, setDragId] = useStatePE(null);
  const [dropId, setDropId] = useStatePE(null);
  const [justAdded, setJustAdded] = useStatePE(null);
  const [notesFor, setNotesFor] = useStatePE(null);
  const updateRow = (id, patch) => setRows(rows.map(r => r.id === id ? { ...r, ...patch } : r));
  const deleteRow = (id) => setRows(rows.filter(r => r.id !== id));
  const addRow = () => { const r = plNewRow(section); setJustAdded(r.id); setRows([...rows, r]); };
  const onDrop = (id) => (e) => {
    e.preventDefault(); if (!dragId || dragId === id) return;
    const a = rows.slice(); const fi = a.findIndex(r => r.id === dragId); const ti = a.findIndex(r => r.id === id);
    const [it] = a.splice(fi, 1); a.splice(ti, 0, it);
    setRows(a); setDragId(null); setDropId(null);
  };
  const noteRow = notesFor ? rows.find(r => r.id === notesFor) : null;
  const mainCol = section.cols.find(c => c.main) || section.cols[0];
  return (
    <React.Fragment>
    <table className="ptable2" style={{ minWidth: section.cols.length * 118 + (section.hasNotes ? 200 : 110) }}>
      <thead><tr><th style={{ width: 16 }}></th>{section.cols.map(c => <th key={c.k} style={{ width: c.w }}>{c.l}</th>)}<th className="row-actions" style={{ width: section.hasNotes ? 160 : 76 }}></th></tr></thead>
      <tbody>
        {rows.map(r => {
          const rowLocked = r._confidential && !sessionUnlocked;
          if (rowLocked) return (
            <tr key={r.id} style={{ background: 'var(--surface-2)' }}>
              <td style={{ padding: '0 4px', opacity: 0.3 }}><Icon name="grip" size={12}/></td>
              <td colSpan={section.cols.length} style={{ padding: '9px 12px' }}><LockedRowNotice onUnlockRequest={onUnlockRequest} reminderDate={r._reminderDate} hint={r._hint}/></td>
              <td className="row-actions"><LockRowControls row={r} sessionUnlocked={sessionUnlocked} onLockRow={onLockRow} onUnlockRow={onUnlockRow}/></td>
            </tr>
          );
          return (
            <tr key={r.id}
              className={[
                dragId === r.id ? 'dragging' : '',
                dropId === r.id ? 'drop-above' : '',
                highlightedRowId === r.id ? 'row-flash' : '',
              ].filter(Boolean).join(' ')}
              onDragOver={e => { e.preventDefault(); if (r.id !== dragId) setDropId(r.id); }} onDrop={onDrop(r.id)}>
              <td className="row-handle" draggable onDragStart={() => setDragId(r.id)} onDragEnd={() => { setDragId(null); setDropId(null); }}><Icon name="grip" size={12}/></td>
              {section.cols.map((c, ci) => {
                const isMeetingRef = meetingOptions && c.k === 'meeting';
                return (
                  <td key={c.k}>
                    <ColInput col={c} value={r[c.k]} onChange={v => updateRow(r.id, { [c.k]: v })}
                      autoFocus={justAdded === r.id && ci === 0}
                      meetingOptions={isMeetingRef ? meetingOptions : undefined}/>
                  </td>
                );
              })}
              <td className="row-actions">
                {section.hasNotes && <NotesButton hasNotes={plRowNotes(r).length > 0} count={plRowNotes(r).length} onClick={() => setNotesFor(r.id)}/>}
                {r._confidential && <HintControl row={r} onUpdate={v => updateRow(r.id, { _hint: v })}/>}
                {r._confidential && <ReminderControl row={r} onUpdate={v => updateRow(r.id, { _reminderDate: v || undefined })}/>}
                <LockRowControls row={r} sessionUnlocked={sessionUnlocked} onLockRow={onLockRow} onUnlockRow={onUnlockRow}/>
                <button className="btn icon ghost sm" title="Delete row" onClick={() => deleteRow(r.id)} style={{ color: 'var(--danger)' }}><Icon name="trash" size={12}/></button>
              </td>
            </tr>
          );
        })}
        <tr className="row-ghost">
          <td></td>
          <td colSpan={section.cols.length + 1}>
            <span className="ghost-cell" onClick={addRow}><Icon name="plus" size={12}/> Add row</span>
          </td>
        </tr>
      </tbody>
    </table>
    {section.hasNotes && (
      <RowNotesModal open={!!noteRow} onClose={() => setNotesFor(null)}
        title={(noteRow ? (noteRow[mainCol.k] || 'Untitled') : '') + ' — notes'}
        sub={section.title}
        notes={noteRow ? plRowNotes(noteRow) : []}
        onChange={arr => updateRow(notesFor, { _notesList: arr, _notes: '' })}/>
    )}
    </React.Fragment>
  );
}

// ── Variant B: quick-add bar + list rows ─────────────────────
function QuickAddList({ section, rows, setRows, sessionUnlocked, onUnlockRequest, onLockRow, onUnlockRow }) {
  const [text, setText] = useStatePE('');
  const [openId, setOpenId] = useStatePE(null);
  const [notesFor, setNotesFor] = useStatePE(null);
  const mainCol = section.cols.find(c => c.main) || section.cols[0];
  const statusCol = section.cols.find(c => c.t === 'status');
  const updateRow = (id, patch) => setRows(rows.map(r => r.id === id ? { ...r, ...patch } : r));
  const deleteRow = (id) => { setRows(rows.filter(r => r.id !== id)); if (openId === id) setOpenId(null); };
  const submit = () => {
    const t = text.trim(); if (!t) return;
    setRows([...rows, plNewRow(section, qaParse(t, section))]);
    setText('');
  };
  const hasDate = section.cols.some(c => c.t === 'date');
  const hasPrio = section.cols.some(c => c.t === 'prio');
  return (
    <div>
      <div className="qa-bar">
        <span className="ic"><Icon name="plus" size={14}/></span>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder={`Add to ${section.title.toLowerCase()}… press Enter`}
        />
        <span className="kbd">↵</span>
      </div>
      {(hasDate || hasPrio) && (
        <div className="qa-hint">
          <span>Shortcuts:</span>
          {hasDate && <span><code>due:fri</code> <code>due:tomorrow</code></span>}
          {hasPrio && <span><code>p1</code>–<code>p4</code> priority</span>}
        </div>
      )}
      {rows.length === 0 && <div className="empty" style={{ padding: '26px 20px', fontSize: 12.5 }}>Nothing here yet — type above to add the first entry.</div>}
      {rows.map(r => {
        const rowLocked = r._confidential && !sessionUnlocked;
        if (rowLocked) return (
          <div key={r.id} className="qa-row" style={{ background: 'var(--surface-2)', cursor: 'default' }}>
            <div className="body"><LockedRowNotice onUnlockRequest={onUnlockRequest} reminderDate={r._reminderDate} hint={r._hint}/></div>
          </div>
        );
        const done = statusCol && r[statusCol.k] === 'Done';
        const isOpen = openId === r.id;
        const metaCols = section.cols.filter(c => c !== mainCol);
        return (
          <React.Fragment key={r.id}>
            <div className={`qa-row ${done ? 'done' : ''}`} onClick={() => setOpenId(isOpen ? null : r.id)}>
              {statusCol && (
                <span className="check" onClick={e => { e.stopPropagation(); updateRow(r.id, { [statusCol.k]: done ? 'To Do' : 'Done' }); }} title={done ? 'Mark not done' : 'Mark done'}>
                  <Icon name="check" size={11}/>
                </span>
              )}
              <div className="body">
                <div className="ttl">{r[mainCol.k] || <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>Untitled</span>}</div>
                <div className="meta">
                  {section.hasNotes && plRowNotes(r).length > 0 && (
                    <span className="pill accent" style={{ cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setNotesFor(r.id); }}>
                      <Icon name="edit" size={9}/>&nbsp;notes{plRowNotes(r).length > 1 ? ' · ' + plRowNotes(r).length : ''}
                    </span>
                  )}
                  {r._confidential && <span className="pill"><Icon name="lock" size={9}/>&nbsp;locked entry</span>}
                  {r._confidential && r._reminderDate && (() => {
                    const today = new Date().toISOString().slice(0, 10);
                    const overdue = r._reminderDate <= today;
                    return <span className="pill" style={{ color: overdue ? 'var(--danger)' : 'var(--accent)' }}><Icon name="bell" size={9}/>&nbsp;{overdue ? 'Reminder overdue' : r._reminderDate}</span>;
                  })()}
                  {metaCols.map(c => {
                    const v = r[c.k];
                    if (c.t === 'status') return <StatusChip key={c.k} value={v} onChange={nv => updateRow(r.id, { [c.k]: nv })} stopClick/>;
                    if (c.t === 'prio') return v ? <PrioChip key={c.k} value={v} onChange={nv => updateRow(r.id, { [c.k]: nv })} stopClick/> : null;
                    if (c.t === 'date') return v ? <DueLabel key={c.k} value={v} status={statusCol ? r[statusCol.k] : ''}/> : null;
                    if (!v) return null;
                    return <span key={c.k} style={{ fontSize: 11.5, color: 'var(--text-subtle)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.l}: {v}</span>;
                  })}
                </div>
              </div>
              <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }}/>
            </div>
            {isOpen && (
              <div className="qa-edit">
                <div className="qa-edit-grid">
                  {section.cols.map(c => (
                    <PlFld key={c.k} label={c.l} span={c.main ? 3 : undefined}>
                      <ColInput col={c} value={r[c.k]} onChange={v => updateRow(r.id, { [c.k]: v })}/>
                    </PlFld>
                  ))}
                  {r._confidential && (
                    <PlFld label="Hint (shown when locked)">
                      <input type="text" className="plf-input" value={r._hint || ''}
                        placeholder="e.g. re: performance review"
                        onChange={e => updateRow(r.id, { _hint: e.target.value || undefined })}/>
                    </PlFld>
                  )}
                  {r._confidential && (
                    <PlFld label="Reminder">
                      <ColInput col={{ t: 'date', k: '_reminderDate' }} value={r._reminderDate || ''} onChange={v => updateRow(r.id, { _reminderDate: v || undefined })}/>
                    </PlFld>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10, alignItems: 'center' }}>
                  {section.hasNotes && <NotesButton hasNotes={plRowNotes(r).length > 0} count={plRowNotes(r).length} onClick={() => setNotesFor(r.id)}/>}
                  {r._confidential
                    ? <button className="btn sm ghost" style={{ color: 'var(--accent)' }} onClick={() => onUnlockRow && onUnlockRow(r.id)}><Icon name="lock" size={11}/> Remove lock</button>
                    : <button className="btn sm ghost" onClick={() => onLockRow && onLockRow(r.id)}><Icon name="lock" size={11}/> Lock entry</button>}
                  <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteRow(r.id)}><Icon name="trash" size={12}/> Delete</button>
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
      {section.hasNotes && (() => {
        const noteRow = notesFor ? rows.find(r => r.id === notesFor) : null;
        return (
          <RowNotesModal open={!!noteRow} onClose={() => setNotesFor(null)}
            title={(noteRow ? (noteRow[mainCol.k] || 'Untitled') : '') + ' — notes'}
            sub={section.title}
            notes={noteRow ? plRowNotes(noteRow) : []}
            onChange={arr => updateRow(notesFor, { _notesList: arr, _notes: '' })}/>
        );
      })()}
    </div>
  );
}

// ── Variant C: read table + edit drawer ──────────────────────
function DrawerTable({ section, rows, setRows, sessionUnlocked, onUnlockRequest, onLockRow, onUnlockRow }) {
  const [openId, setOpenId] = useStatePE(null);
  const [notesFor, setNotesFor] = useStatePE(null);
  const updateRow = (id, patch) => setRows(rows.map(r => r.id === id ? { ...r, ...patch } : r));
  const deleteRow = (id) => { setRows(rows.filter(r => r.id !== id)); setOpenId(null); };
  const addRow = () => { const r = plNewRow(section); setRows([...rows, r]); setOpenId(r.id); };
  const openIdx = rows.findIndex(r => r.id === openId);
  const openRow = openIdx >= 0 ? rows[openIdx] : null;
  const statusCol = section.cols.find(c => c.t === 'status');
  const mainCol = section.cols.find(c => c.main) || section.cols[0];
  return (
    <div>
      <table className="ptable2 dr-table" style={{ minWidth: section.cols.length * 112 + 40 }}>
        <thead><tr>{section.cols.map(c => <th key={c.k} style={{ width: c.w }}>{c.l}</th>)}<th className="row-actions"></th></tr></thead>
        <tbody>
          {rows.map(r => {
            const rowLocked = r._confidential && !sessionUnlocked;
            if (rowLocked) return (
              <tr key={r.id} style={{ background: 'var(--surface-2)', cursor: 'default' }}>
                <td colSpan={section.cols.length + 1} style={{ padding: '9px 12px' }}><LockedRowNotice onUnlockRequest={onUnlockRequest} reminderDate={r._reminderDate} hint={r._hint}/></td>
              </tr>
            );
            return (
              <tr key={r.id} onClick={() => setOpenId(r.id)}>
                {section.cols.map(c => (
                  <td key={c.k}>
                    {c.t === 'status' ? <StatusChip value={r[c.k]} onChange={v => updateRow(r.id, { [c.k]: v })} stopClick/>
                      : c.t === 'prio' ? <PrioChip value={r[c.k]} onChange={v => updateRow(r.id, { [c.k]: v })} stopClick/>
                      : c.t === 'date' ? <span className="cellv"><DueLabel value={r[c.k]} status={statusCol ? r[statusCol.k] : ''}/></span>
                      : <span className={`cellv ${r[c.k] ? '' : 'muted2'}`}>{r[c.k] || '—'}</span>}
                  </td>
                ))}
                <td className="row-actions">
                  {r._confidential && r._reminderDate && (() => {
                    const today = new Date().toISOString().slice(0, 10);
                    return <Icon name="bell" size={11} style={{ color: r._reminderDate <= today ? 'var(--danger)' : 'var(--accent)', marginRight: 4 }}/>;
                  })()}
                  {r._confidential && <Icon name="lock" size={11} style={{ color: 'var(--text-subtle)', marginRight: 6 }}/>}
                  {section.hasNotes && plRowNotes(r).length > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--accent)', fontSize: 10.5, fontFamily: 'var(--mono)', marginRight: 6 }}>
                      <Icon name="edit" size={11}/>{plRowNotes(r).length > 1 ? plRowNotes(r).length : ''}
                    </span>
                  )}
                  <Icon name="chevron-right" size={13} style={{ color: 'var(--text-subtle)' }}/>
                </td>
              </tr>
            );
          })}
          <tr className="row-ghost">
            <td colSpan={section.cols.length + 1}>
              <span className="ghost-cell" onClick={addRow}><Icon name="plus" size={12}/> Add entry</span>
            </td>
          </tr>
        </tbody>
      </table>

      {openRow && (
        <React.Fragment>
          <div className="pl-drawer-veil" onClick={() => setOpenId(null)}></div>
          <div className="pl-drawer">
            <div className="pl-drawer-head">
              <span className="plm-ic"><Icon name={section.icon || 'edit'} size={15}/></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {openRow[mainCol.k] || 'New entry'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{section.title} · {openIdx + 1} of {rows.length}</div>
              </div>
              <button className="btn icon ghost sm" disabled={openIdx <= 0} onClick={() => setOpenId(rows[openIdx - 1].id)} title="Previous"><Icon name="chevron-up" size={14}/></button>
              <button className="btn icon ghost sm" disabled={openIdx >= rows.length - 1} onClick={() => setOpenId(rows[openIdx + 1].id)} title="Next"><Icon name="chevron-down" size={14}/></button>
              <button className="btn icon ghost sm" onClick={() => setOpenId(null)} aria-label="Close"><Icon name="x" size={14}/></button>
            </div>
            <div className="pl-drawer-body">
              {section.cols.map(c => (
                <PlFld key={c.k} label={c.l}>
                  <ColInput col={c} value={openRow[c.k]} onChange={v => updateRow(openRow.id, { [c.k]: v })}/>
                </PlFld>
              ))}
              {openRow._confidential && (
                <PlFld label="Hint (shown when locked)">
                  <input type="text" className="plf-input" value={openRow._hint || ''}
                    placeholder="e.g. re: performance review"
                    onChange={e => updateRow(openRow.id, { _hint: e.target.value || undefined })}/>
                </PlFld>
              )}
              {openRow._confidential && (
                <PlFld label="Reminder">
                  <ColInput col={{ t: 'date', k: '_reminderDate' }} value={openRow._reminderDate || ''} onChange={v => updateRow(openRow.id, { _reminderDate: v || undefined })}/>
                </PlFld>
              )}
              {section.hasNotes && (
                <PlFld label={`Notes${plRowNotes(openRow).length ? ' · ' + plRowNotes(openRow).length : ''}`}>
                  {plRowNotes(openRow).map(n => (
                    <div key={n.id} onClick={() => setNotesFor(openRow.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', cursor: 'pointer', fontSize: 12.5 }}>
                      <Icon name="edit" size={11} style={{ color: 'var(--accent)', flexShrink: 0 }}/>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title || 'Untitled'}</span>
                      <span style={{ color: 'var(--text-subtle)', fontSize: 11, marginLeft: 'auto', flexShrink: 0, fontFamily: 'var(--mono)' }}>
                        {new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  ))}
                  <NotesButton hasNotes={plRowNotes(openRow).length > 0} count={plRowNotes(openRow).length} onClick={() => setNotesFor(openRow.id)}/>
                </PlFld>
              )}
            </div>
            <div className="pl-drawer-foot">
              <button className="btn sm ghost" style={{ color: 'var(--danger)' }} onClick={() => deleteRow(openRow.id)}><Icon name="trash" size={12}/> Delete</button>
              {openRow._confidential
                ? <button className="btn sm ghost" style={{ color: 'var(--accent)' }} onClick={() => onUnlockRow && onUnlockRow(openRow.id)}><Icon name="lock" size={11}/> Remove lock</button>
                : <button className="btn sm ghost" onClick={() => onLockRow && onLockRow(openRow.id)}><Icon name="lock" size={11}/> Lock entry</button>}
              <span style={{ flex: 1 }}></span>
              <button className="btn sm primary" onClick={() => setOpenId(null)}>Done</button>
            </div>
          </div>
        </React.Fragment>
      )}

      {section.hasNotes && (() => {
        const noteRow = notesFor ? rows.find(r => r.id === notesFor) : null;
        return (
          <RowNotesModal open={!!noteRow} onClose={() => setNotesFor(null)}
            title={(noteRow ? (noteRow[mainCol.k] || 'Untitled') : '') + ' — notes'}
            sub={section.title}
            notes={noteRow ? plRowNotes(noteRow) : []}
            onChange={arr => updateRow(notesFor, { _notesList: arr, _notes: '' })}/>
        );
      })()}
    </div>
  );
}

// ── Non-table editors ─────────────────────────────────────────
const plTaStyle = {
  width: '100%', boxSizing: 'border-box', border: 0, background: 'transparent', font: 'inherit',
  fontSize: 13, color: 'var(--text)', outline: 'none', resize: 'vertical', padding: 0, lineHeight: 1.5,
};

function ThemesGrid({ section, themes, setThemes }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: 14 }}>
      {section.fields.map(f => (
        <div key={f.k} style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, color: 'var(--text-subtle)' }}>{f.l}</div>
          <textarea value={themes[f.k] || ''} rows={2} style={plTaStyle}
            onChange={e => setThemes(t => ({ ...t, [f.k]: e.target.value }))}
            onContextMenu={e => plOpenCtx(e, themes[f.k] || '')}/>
        </div>
      ))}
    </div>
  );
}

function EowGrid({ value, onChange }) {
  const items = [['well', 'What went well', 'success'], ['didNot', 'What did not', 'danger'], ['carry', 'Carry forward', 'accent']];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: 14 }}>
      {items.map(([k, label, tone]) => (
        <div key={k} style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 10, borderTop: `2px solid var(--${tone})` }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6, color: 'var(--text-subtle)' }}>{label}</div>
          <textarea value={value[k] || ''} rows={4} style={plTaStyle}
            onChange={e => onChange({ ...value, [k]: e.target.value })}
            onContextMenu={e => plOpenCtx(e, value[k] || '')}/>
        </div>
      ))}
    </div>
  );
}

// ── Section card wrapper (header lock controls match the old UI) ──
function SectionCard({ section, data, setData, themes, setThemes, entryStyle,
                       isConfidential, sessionUnlocked, onMarkConfidential, onRemoveConfidential, onUnlockRequest,
                       onLockRow, onUnlockRow, highlightedRowId, meetingOptions, domId }) {
  const locked = isConfidential && !sessionUnlocked;
  const rows = section.type === 'table' ? (data[section.id] || []) : null;
  const openCount = rows ? rows.filter(r => PL_OPEN(r.status || '')).length : null;
  const setRows = v => setData(d => ({ ...d, [section.id]: v }));
  const entryProps = { section, rows, setRows, sessionUnlocked, onUnlockRequest, onLockRow, onUnlockRow, highlightedRowId, meetingOptions };
  return (
    <div className="card pl-section" id={domId} data-screen-label={section.title}>
      <div className="card-head">
        <h3>
          <span className="ic"><Icon name={section.icon || 'list'} size={14}/></span>
          {section.title}
          {rows && rows.length > 0 && !locked && <span className="pl-sec-count">{openCount} open · {rows.length} total</span>}
        </h3>
        <div className="actions" style={{ alignItems: 'center', gap: 6 }}>
          {isConfidential && sessionUnlocked && (
            <span style={{ fontSize: 11, color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <Icon name="lock" size={11}/> confidential
            </span>
          )}
          {isConfidential && sessionUnlocked && (
            <button className="btn icon ghost sm" title="Remove confidential lock" onClick={onRemoveConfidential} style={{ color: 'var(--accent)' }}>
              <Icon name="lock" size={13}/>
            </button>
          )}
          {!isConfidential && (
            <button className="btn ghost sm" title="Mark section as confidential" onClick={onMarkConfidential}
              style={{ opacity: 0.45, transition: 'opacity 0.15s', display: 'flex', alignItems: 'center', gap: 4 }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0.45'}>
              <Icon name="lock" size={13}/> Confidential
            </button>
          )}
        </div>
      </div>
      {locked ? (
        <div style={{ padding: '34px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span className="plm-ic" style={{ width: 40, height: 40, borderRadius: 12 }}><Icon name="lock" size={17}/></span>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>Confidential</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>This section is password protected.</div>
          <button className="btn sm" onClick={onUnlockRequest}>Enter password to view</button>
        </div>
      ) : (
        <div className="card-body flush">
          {section.type === 'table' && (
            entryStyle === 'quickadd' ? <QuickAddList {...entryProps}/>
              : entryStyle === 'drawer' ? <DrawerTable {...entryProps}/>
              : <InlineTable {...entryProps}/>
          )}
          {section.type === 'keyval' && <ThemesGrid section={section} themes={themes} setThemes={setThemes}/>}
          {section.type === 'textarea' && (
            <div style={{ padding: 14 }}>
              <textarea
                value={data[section.id] || ''} rows={6}
                onChange={e => setData(d => ({ ...d, [section.id]: e.target.value }))}
                onContextMenu={e => plOpenCtx(e, '')}
                placeholder="Anything that doesn't fit elsewhere…"
                style={{ ...plTaStyle, border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.55 }}/>
            </div>
          )}
          {section.type === 'eow' && <EowGrid value={data[section.id] || { well: '', didNot: '', carry: '' }} onChange={v => setData(d => ({ ...d, [section.id]: v }))}/>}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { InlineTable, QuickAddList, DrawerTable, ThemesGrid, EowGrid, SectionCard, LockRowControls, LockedRowNotice });
export { LockRowControls, HintControl, ReminderControl, LockedRowNotice, InlineTable, QuickAddList, DrawerTable, ThemesGrid, EowGrid, SectionCard };