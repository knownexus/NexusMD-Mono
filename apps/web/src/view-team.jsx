import React from 'react';
import { NexusMDData } from './data.js';
import { Avatar, MenuButton, TypeIcon, nexusMDPushPref } from './components.jsx';
import { Icon } from './icons.jsx';
import { enrichTeamMember } from '@nexusmd/core';

// view-team.jsx — Team / People view

const { useState: useStateT } = React;

function slugifyLocal(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

function getInitials(name) {
  const parts = (name || '').trim().split(' ');
  const first = parts[0] || '', last = parts[parts.length - 1] || '';
  return ((first[0] || '') + (last[0] || first[1] || '')).toUpperCase() || '?';
}

function AddMemberModal({ open, onClose, onAdd }) {
  const [name, setName] = useStateT('');
  const [role, setRole] = useStateT('Developer');
  const [tz, setTz] = useStateT('UTC');
  const [error, setError] = useStateT('');

  const inputStyle = {
    height: 34, padding: '0 10px', border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--surface)', fontSize: 13, outline: 'none', width: '100%',
    color: 'var(--text)', boxSizing: 'border-box',
  };

  const reset = () => { setName(''); setRole('Developer'); setTz('UTC'); setError(''); };

  const handleAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    const id = slugifyLocal(trimmed);
    if (NexusMDData.TEAM.find(t => t.id === id)) { setError(`"${trimmed}" is already in the team`); return; }
    onAdd({
      id,
      name: trimmed,
      displayName: trimmed,
      role: role.trim() || 'Developer',
      initials: getInitials(trimmed),
      tz: tz.trim() || 'UTC',
      status: 'online',
      focus: 'Working…',
      isCustom: true,
    });
    reset();
    onClose();
  };

  const handleClose = () => { reset(); onClose(); };

  if (!open) return null;
  return (
    <div id="modal-add-member" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow-pop)', padding: 28, width: 400, maxWidth: '90vw',
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', flex: 1 }}>
            Add Team Member
          </h2>
          <button className="btn icon ghost sm" onClick={handleClose}><Icon name="x" size={14}/></button>
        </div>

        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)', marginTop: -8 }}>
          This member will only appear in your local dashboard and won't affect Azure DevOps.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
              Name <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input value={name} onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="Jane Smith" style={inputStyle}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              autoFocus/>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>Role</label>
            <input value={role} onChange={e => setRole(e.target.value)}
              placeholder="Developer" style={inputStyle}/>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>Timezone</label>
            <input value={tz} onChange={e => setTz(e.target.value)}
              placeholder="UTC" style={inputStyle}/>
          </div>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn ghost" onClick={handleClose}>Cancel</button>
          <button className="btn primary" onClick={handleAdd}>Add member</button>
        </div>
      </div>
    </div>
  );
}

function NoteModal({ open, dev, onClose, onSave }) {
  const [text, setText] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { if (open) setText(''); }, [open]);

  const handleSave = async () => {
    if (!text.trim()) return;
    setSaving(true);
    await onSave(dev, text.trim());
    setSaving(false);
    onClose();
  };

  if (!open || !dev) return null;
  return (
    <div id="modal-team-note" style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'var(--shadow-pop)', padding:28, width:440, maxWidth:'90vw', display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <h2 style={{ margin:0, fontSize:16, fontWeight:600, flex:1 }}>Add note — {dev.name}</h2>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave(); }}
          placeholder="Write a note about this team member…"
          autoFocus
          rows={4}
          style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface-2)', fontSize:13, outline:'none', resize:'vertical', color:'var(--text)', boxSizing:'border-box', fontFamily:'var(--sans)' }}
        />
        <div style={{ fontSize:11, color:'var(--text-subtle)' }}>Saved to this week's Planner under Team notes · ⌘↵ to save</div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleSave} disabled={saving || !text.trim()}>
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScheduleOneOnOneModal({ open, dev, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = React.useState(today);
  const [time, setTime] = React.useState('10:00');
  const [duration, setDuration] = React.useState('60');
  const [points, setPoints] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) { setDate(today); setTime('10:00'); setDuration('60'); setPoints(''); }
  }, [open]);

  const handleSave = async () => {
    if (!date || !time) return;
    setSaving(true);
    await onSave(dev, { date, time, duration: parseInt(duration, 10) || 60, points });
    setSaving(false);
    onClose();
  };

  const inputStyle = { height:34, padding:'0 10px', border:'1px solid var(--border)', borderRadius:6, background:'var(--surface-2)', fontSize:13, outline:'none', color:'var(--text)', boxSizing:'border-box', width:'100%' };

  if (!open || !dev) return null;
  return (
    <div id="modal-schedule-1on1" style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, boxShadow:'var(--shadow-pop)', padding:28, width:440, maxWidth:'90vw', display:'flex', flexDirection:'column', gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <h2 style={{ margin:0, fontSize:16, fontWeight:600, flex:1 }}>Schedule 1:1 — {dev?.name}</h2>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)' }}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle}/>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)' }}>Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle}/>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)' }}>Duration</label>
            <select value={duration} onChange={e => setDuration(e.target.value)} style={{ ...inputStyle, appearance:'none' }}>
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">1 hour</option>
              <option value="90">1.5 hours</option>
            </select>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <label style={{ fontSize:12, fontWeight:500, color:'var(--text-muted)' }}>Talking points (optional)</label>
          <textarea value={points} onChange={e => setPoints(e.target.value)} rows={3}
            placeholder="Topics to cover…"
            style={{ ...inputStyle, height:'auto', padding:'8px 10px', resize:'vertical', fontFamily:'var(--sans)' }}/>
        </div>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleSave} disabled={saving || !date || !time}>
            {saving ? 'Scheduling…' : 'Schedule 1:1'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeamView({ team, workItems, prs, onOpenItem, onOpenPerson, onTeamChange, onAddNote, onScheduleOneOnOne }) {
  const [search, setSearch] = useStateT('');
  const [removedIds, setRemovedIds] = useStateT(() => {
    try { return JSON.parse(localStorage.getItem('nexusmd.team.removed') || '[]'); } catch { return []; }
  });
  const [customMembers, setCustomMembers] = useStateT(() => {
    try { return JSON.parse(localStorage.getItem('nexusmd.team.custom') || '[]'); } catch { return []; }
  });
  const [showRemoved, setShowRemoved] = useStateT(false);
  const [showAddModal, setShowAddModal] = useStateT(false);
  const [noteTarget, setNoteTarget] = useStateT(null);
  const [scheduleTarget, setScheduleTarget] = useStateT(null);

  const removeAzureMember = (id) => {
    const next = [...removedIds, id];
    setRemovedIds(next);
    const s = JSON.stringify(next);
    localStorage.setItem('nexusmd.team.removed', s);
    nexusMDPushPref?.('nexusmd.team.removed', s);
  };

  const restoreAzureMember = (id) => {
    const next = removedIds.filter(x => x !== id);
    setRemovedIds(next);
    const s = JSON.stringify(next);
    localStorage.setItem('nexusmd.team.removed', s);
    nexusMDPushPref?.('nexusmd.team.removed', s);
  };

  const addCustomMember = (member) => {
    const next = [...customMembers, member];
    setCustomMembers(next);
    const s = JSON.stringify(next);
    localStorage.setItem('nexusmd.team.custom', s);
    nexusMDPushPref?.('nexusmd.team.custom', s);
  };

  const removeCustomMember = (id) => {
    const next = customMembers.filter(m => m.id !== id);
    setCustomMembers(next);
    const s = JSON.stringify(next);
    localStorage.setItem('nexusmd.team.custom', s);
    nexusMDPushPref?.('nexusmd.team.custom', s);
  };

  // Azure-sourced members only (from the prop, excluding any custom-flagged ones already merged in)
  const azureTeam = team.filter(t => !t.isCustom);
  const visibleAzure = azureTeam.filter(t => !removedIds.includes(t.id));
  const removedAzureTeam = azureTeam.filter(t => removedIds.includes(t.id));

  // Full visible list: visible Azure + active custom members
  const allVisible = [...visibleAzure, ...customMembers];

  // Sync allVisible back to App state and the global whenever membership changes
  React.useEffect(() => {
    NexusMDData.TEAM = allVisible;
    onTeamChange?.(allVisible);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removedIds, customMembers]);

  const enriched = allVisible.map(t => enrichTeamMember(t, { workItems, prs }));
  const filtered = search
    ? enriched.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : enriched;

  return (
    <div>
      <AddMemberModal open={showAddModal} onClose={() => setShowAddModal(false)} onAdd={addCustomMember}/>
      <NoteModal
        open={noteTarget !== null}
        dev={noteTarget}
        onClose={() => setNoteTarget(null)}
        onSave={onAddNote}
      />
      <ScheduleOneOnOneModal
        open={scheduleTarget !== null}
        dev={scheduleTarget}
        onClose={() => setScheduleTarget(null)}
        onSave={onScheduleOneOnOne}
      />

      <div className="page-head">
        <div>
          <h1>Team</h1>
          <div className="sub">
            {allVisible.length} members
            {customMembers.length > 0 && ` · ${customMembers.length} local`}
            {' · '}{allVisible.filter(t => t.status === 'online').length} online
            {' · '}{allVisible.filter(t => t.status === 'pto').length} PTO
          </div>
        </div>
        <div className="page-head-actions">
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }}/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find someone…" style={{
              height: 30, padding: '0 10px 0 28px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', fontSize: 12.5, outline: 'none', width: 200
            }}/>
          </div>
          {removedAzureTeam.length > 0 && (
            <button className="btn sm ghost" onClick={() => setShowRemoved(v => !v)}>
              <Icon name="team" size={13}/> {showRemoved ? 'Hide hidden' : `${removedAzureTeam.length} hidden`}
            </button>
          )}
          <button className="btn sm" onClick={() => setShowAddModal(true)}>
            <Icon name="plus" size={13}/> Add member
          </button>
        </div>
      </div>

      <div className="team-grid">
        {filtered.map(t => (
          <DevCard key={t.id} dev={t} onOpenItem={onOpenItem} onOpenPerson={onOpenPerson}
            onRemove={t.isCustom ? null : removeAzureMember}
            onDelete={t.isCustom ? removeCustomMember : null}
            onAddNote={onAddNote ? () => setNoteTarget(t) : null}
            onScheduleOneOnOne={onScheduleOneOnOne ? () => setScheduleTarget(t) : null}
          />
        ))}
        {filtered.length === 0 && (
          <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: '24px 0' }}>No members match your search.</div>
        )}
      </div>

      {showRemoved && removedAzureTeam.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Hidden members (Azure)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {removedAzureTeam.map(t => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5 }}>
                <Avatar who={t.id} size="xs"/>
                <span>{t.name}</span>
                <button className="btn sm ghost" style={{ height: 20, padding: '0 6px', fontSize: 11 }}
                  onClick={() => restoreAzureMember(t.id)}>Restore</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DevCard({ dev, onOpenItem, onOpenPerson, onRemove, onDelete, onAddNote, onScheduleOneOnOne }) {
  const statusColor = {
    online: 'var(--success)', meeting: 'var(--warning)', away: 'var(--text-subtle)', pto: 'var(--text-subtle)'
  };
  const statusLabel = {
    online: 'Online', meeting: 'In a meeting', away: 'Away', pto: 'PTO'
  };

  const menuItems = [
    { label: 'Open profile', icon: <Icon name="eye" size={12}/>, onClick: () => onOpenPerson(dev) },
    { label: 'Add note', icon: <Icon name="message" size={12}/>, onClick: () => onAddNote?.() },
    { label: 'Send message', icon: <Icon name="send" size={12}/> },
    ...(onRemove ? [{ label: 'Hide from dashboard', icon: <Icon name="x" size={12}/>, danger: true, onClick: () => onRemove(dev.id) }] : []),
    ...(onDelete ? [{ label: 'Remove member', icon: <Icon name="x" size={12}/>, danger: true, onClick: () => onDelete(dev.id) }] : []),
  ];

  return (
    <div className="dev-card" onClick={() => onOpenPerson(dev)}>
      <div className="dev-card-head">
        <div style={{ position: 'relative' }}>
          <Avatar who={dev.id} size="lg"/>
          <span style={{
            position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: '50%',
            background: statusColor[dev.status], border: '2px solid var(--surface)'
          }}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="name" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="truncate">{dev.name}</span>
            {dev.isCustom && (
              <span style={{
                fontSize: 10, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
                background: 'var(--accent-soft)', color: 'var(--accent)',
                border: '1px solid var(--accent-border)', fontWeight: 500, lineHeight: 1.4,
              }}>Local</span>
            )}
          </div>
          <div className="role">{dev.role} · {dev.tz} · {statusLabel[dev.status]}</div>
        </div>
        <MenuButton items={menuItems}/>
      </div>

      <div className="dev-card-now">
        <span className="label">Now</span>
        {dev.current ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}
            onClick={(e) => { e.stopPropagation(); onOpenItem(dev.current); }}>
            <TypeIcon type={dev.current.type}/>
            <span className="mono muted" style={{ fontSize: 11 }}>#{dev.current.id}</span>
            <span className="truncate" style={{ fontSize: 12.5 }}>{dev.current.title}</span>
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>{dev.focus}</span>
        )}
      </div>

      <div className="dev-card-stats">
        <div className="dev-stat">
          <div className="dev-stat-label">Active</div>
          <div className="dev-stat-value">{dev.active.length}</div>
        </div>
        <div className="dev-stat">
          <div className="dev-stat-label">Open PRs</div>
          <div className="dev-stat-value">{dev.myPRs.length}</div>
        </div>
        <div className="dev-stat">
          <div className="dev-stat-label">Sprint pts</div>
          <div className="dev-stat-value">{dev.points}</div>
        </div>
      </div>

      {dev.blocked.length > 0 && (
        <div style={{
          background: 'var(--danger-soft)', color: 'var(--danger)', padding: '6px 10px', borderRadius: 6,
          fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6
        }}>
          <Icon name="alert" size={12}/>
          <span style={{ fontWeight: 500 }}>{dev.blocked.length} blocker{dev.blocked.length !== 1 ? 's' : ''}</span>
          <span className="truncate" style={{ opacity: 0.8 }}>· {dev.blocked[0].title}</span>
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, color:'var(--text-subtle)', borderTop:'1px solid var(--border)', paddingTop:10, marginTop:2 }}>
        <Icon name="message" size={11}/>
        <span>1:1</span>
        <span className="spacer"/>
        <button className="btn sm ghost" style={{ height:22, padding:'0 6px', fontSize:11 }}
          onClick={e => { e.stopPropagation(); onScheduleOneOnOne?.(); }}>
          <Icon name="plus" size={10}/> Schedule
        </button>
        <button className="btn sm ghost" style={{ height:22, padding:'0 6px', fontSize:11 }}
          onClick={e => { e.stopPropagation(); onAddNote?.(); }}>
          <Icon name="plus" size={10}/> Note
        </button>
      </div>
    </div>
  );
}
