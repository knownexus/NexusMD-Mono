import React from 'react'
import { isTerminalState, adoTypeToHelm } from '@nexusmd/core'
import { Icon } from '../icons.jsx'
import { toast } from '../toast.jsx'
import { StateDot, Prio } from '../components.jsx'
import { Avatar, TypeIcon, ProjectChip, Drawer } from '../app-components.jsx'
import { useNexusData } from '../data-context.jsx'
import { TagInput, AreaTreePicker } from './wi-field-pickers.jsx'
import { SettField } from './shell-parts.jsx'
import { WorkItemDetail } from './work-item-detail.jsx'
import { BuildDetail } from './build-detail.jsx'

const { useState, useEffect, useMemo } = React

// Work-item / person / PR drawer pieces that web and app render identically.
// Platform calls come in as props (onSubmit, patchFields, confidential, PRDetail);
// everything else is read from the NexusDataProvider.

export const DEFAULT_WI_TYPES = ['Bug', 'Task', 'User Story', 'Feature', 'Epic']
export const DEFAULT_PRIORITIES = [1, 2, 3, 4]
export const PRIORITY_LABELS = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' }

export const settInputStyle = {
  width: '100%', padding: '8px 12px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13, boxSizing: 'border-box',
}

// ── Pickers bound to the host data ────────────────────────────────────────────
export function DataTagInput(props) {
  const { data } = useNexusData()
  const knownTags = useMemo(() => {
    const s = new Set()
    ;(data.WORK_ITEMS || []).forEach(wi => {
      const raw = wi.fields?.['System.Tags'] || wi.tags || ''
      const parts = Array.isArray(raw) ? raw : String(raw).split(';')
      parts.forEach(t => { const tr = t.trim(); if (tr) s.add(tr) })
    })
    return [...s].sort((a, b) => a.localeCompare(b))
  }, [])
  return <TagInput {...props} knownTags={knownTags} />
}

export function DataAreaTreePicker(props) {
  const { data } = useNexusData()
  return <AreaTreePicker {...props} areas={data.PROJECT_AREAS || []} />
}

// ── CreateWIModal ─────────────────────────────────────────────────────────────
// onSubmit({ project, type, fields }) creates the item and throws on failure.
export function CreateWIModal({ open, onClose, onCreated, onSubmit, prefill, team: teamProp, inputStyle = settInputStyle }) {
  const { data } = useNexusData()
  const [project,             setProject]             = useState('');
  const [type,                setType]                = useState('Task');
  const [title,               setTitle]               = useState('');
  const [assignee,            setAssignee]            = useState('');
  const [state,               setState]               = useState('');
  const [priority,            setPriority]            = useState('');
  const [tags,                setTags]                = useState('');
  const [description,         setDescription]         = useState('');
  const [acceptanceCriteria,  setAcceptanceCriteria]  = useState('');
  const [reproSteps,          setReproSteps]          = useState('');
  const [systemInfo,          setSystemInfo]          = useState('');
  const [storyPoints,         setStoryPoints]         = useState('');
  const [remainingWork,       setRemainingWork]       = useState('');
  const [activity,            setActivity]            = useState('');
  const [status,              setStatus]              = useState('');
  const [saving,              setSaving]              = useState(false);

  const team     = teamProp || data.TEAM || [];
  const STATES   = data.STATES || [];
  const TYPES    = data.TYPES?.length ? data.TYPES : DEFAULT_WI_TYPES;
  const PRIORITIES = data.PRIORITIES?.length ? data.PRIORITIES : DEFAULT_PRIORITIES;
  const projects = ((data.CONFIG_PROJECTS || []).length
    ? data.CONFIG_PROJECTS.map(p => ({ id: p, name: p }))
    : (data.PROJECTS || []).map(p => ({ id: p.id, name: p.name }))
  );

  const isBug      = type === 'Bug';
  const isTask     = type === 'Task';
  const isStory    = type === 'User Story';
  const isFeature  = type === 'Feature';
  const showAC     = isStory || isFeature;
  const nexusMDType   = adoTypeToHelm(type);
  const hasNumeric = isTask || isStory;

  const resetFields = () => {
    setTitle(''); setAssignee(''); setState(''); setPriority(''); setTags('');
    setDescription(''); setAcceptanceCriteria(''); setReproSteps('');
    setSystemInfo(''); setStoryPoints(''); setRemainingWork(''); setActivity('');
    setStatus(''); setSaving(false);
  };

  useEffect(() => {
    if (!open) return;
    setProject(projects[0]?.name || '');
    setType('Task');
    resetFields();
  }, [open]);

  useEffect(() => {
    if (!open || !prefill) return;
    if (prefill.project)     setProject(prefill.project);
    if (prefill.type)        setType(prefill.type);
    if (prefill.title)       setTitle(prefill.title);
    if (prefill.description) setDescription(prefill.description);
    if (prefill.tags)        setTags(prefill.tags);
  }, [open, prefill]);

  const submit = async () => {
    if (!title.trim())   { setStatus('Title is required.');   return; }
    if (!project.trim()) { setStatus('Project is required.'); return; }
    setSaving(true); setStatus('Creating…');
    try {
      const fields = { 'System.Title': title.trim() };
      if (assignee)                  fields['System.AssignedTo']                          = assignee;
      if (state)                     fields['System.State']                               = state;
      if (priority)                  fields['Microsoft.VSTS.Common.Priority']             = parseInt(priority, 10);
      if (tags.trim())               fields['System.Tags']                                = tags.trim();
      if (description.trim())        fields['System.Description']                         = description.trim();
      if (acceptanceCriteria.trim()) fields['Microsoft.VSTS.Common.AcceptanceCriteria']   = acceptanceCriteria.trim();
      if (reproSteps.trim())         fields['Microsoft.VSTS.TCM.ReproSteps']              = reproSteps.trim();
      if (systemInfo.trim())         fields['Microsoft.VSTS.TCM.SystemInfo']              = systemInfo.trim();
      if (storyPoints)               fields['Microsoft.VSTS.Scheduling.StoryPoints']      = parseFloat(storyPoints);
      if (remainingWork)             fields['Microsoft.VSTS.Scheduling.RemainingWork']    = parseFloat(remainingWork);
      if (activity)                  fields['Microsoft.VSTS.Common.Activity']             = activity;
      await onSubmit({ project: project.trim(), type, fields });
      setStatus('Created.');
      onCreated?.();
      setTimeout(onClose, 600);
    } catch (e) {
      setStatus('Error: ' + e.message);
    } finally { setSaving(false); }
  };

  if (!open) return null;
  return (
    <div id="modal-create-workitem" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow-pop)', width: 580, maxWidth: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <TypeIcon type={nexusMDType}/>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, flex: 1 }}>New {type}</h2>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Project + Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <SettField label="Project">
              <select value={project} onChange={e => setProject(e.target.value)} style={inputStyle}>
                {projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </SettField>
            <SettField label="Type">
              <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </SettField>
          </div>

          {/* Title */}
          <SettField label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={`Short, descriptive ${type.toLowerCase()} title…`}
              style={inputStyle} autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) submit(); }} />
          </SettField>

          {/* Assignee + State */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <SettField label="Assigned To">
              <select value={assignee} onChange={e => setAssignee(e.target.value)} style={inputStyle}>
                <option value="">Unassigned</option>
                {team.map(t => <option key={t.id} value={t.name || t.displayName}>{t.name || t.displayName}</option>)}
              </select>
            </SettField>
            <SettField label="State">
              {STATES.length > 0 ? (
                <select value={state} onChange={e => setState(e.target.value)} style={inputStyle}>
                  <option value="">Default</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input value={state} onChange={e => setState(e.target.value)} placeholder="Default" style={inputStyle} />
              )}
            </SettField>
          </div>

          {/* Priority + Tags + numeric (Story Points / Remaining Work) */}
          <div style={{ display: 'grid', gridTemplateColumns: hasNumeric ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10 }}>
            <SettField label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
                <option value="">None</option>
                {PRIORITIES.map(p => (
                  <option key={p} value={p}>{p}{PRIORITY_LABELS[p] ? ` – ${PRIORITY_LABELS[p]}` : ''}</option>
                ))}
              </select>
            </SettField>
            <SettField label="Tags">
              <DataTagInput value={tags} onChange={setTags} style={inputStyle} />
            </SettField>
            {isStory && (
              <SettField label="Story Points">
                <input type="number" min="0" step="0.5" value={storyPoints}
                  onChange={e => setStoryPoints(e.target.value)} placeholder="—" style={inputStyle} />
              </SettField>
            )}
            {isTask && (
              <SettField label="Remaining Work (h)">
                <input type="number" min="0" step="0.5" value={remainingWork}
                  onChange={e => setRemainingWork(e.target.value)} placeholder="—" style={inputStyle} />
              </SettField>
            )}
          </div>

          {/* Activity — Task only */}
          {isTask && (
            <SettField label="Activity">
              <select value={activity} onChange={e => setActivity(e.target.value)} style={inputStyle}>
                <option value="">None</option>
                {['Development', 'Testing', 'Requirements', 'Documentation', 'Deployment', 'Design'].map(a => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </SettField>
          )}

          {/* ── Divider before content fields ── */}
          <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />

          {/* Description — all types */}
          <SettField label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              style={{ ...inputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
          </SettField>

          {/* Acceptance Criteria — User Story / Feature */}
          {showAC && (
            <SettField label="Acceptance Criteria" hint="Given… When… Then…">
              <textarea value={acceptanceCriteria} onChange={e => setAcceptanceCriteria(e.target.value)} rows={4}
                style={{ ...inputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
            </SettField>
          )}

          {/* Repro Steps — Bug */}
          {isBug && (
            <SettField label="Repro Steps">
              <textarea value={reproSteps} onChange={e => setReproSteps(e.target.value)} rows={4}
                placeholder={'1. Open…\n2. Click…\n3. Observe…'}
                style={{ ...inputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
            </SettField>
          )}

          {/* System Info — Bug */}
          {isBug && (
            <SettField label="System Info" hint="Browser, OS, app version, environment">
              <textarea value={systemInfo} onChange={e => setSystemInfo(e.target.value)} rows={2}
                style={{ ...inputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
            </SettField>
          )}

        </div>

        {/* ── Footer ── */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {status && <div className="muted" style={{ fontSize: 12.5 }}>{status}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── WIDetail ──────────────────────────────────────────────────────────────────
// patchFields(id, ops) applies [{ op, path, value }] JSON-patch ops and throws on failure.
export function WIDetail({ item, setWorkItems, team: teamProp, patchFields }) {
  const { data } = useNexusData()
  const { STATES, PRIORITIES: PRIORITIES_RAW } = data;
  const PRIORITIES = PRIORITIES_RAW?.length ? PRIORITIES_RAW : DEFAULT_PRIORITIES;
  const TEAM = teamProp || data.TEAM || [];

  // Local copy for optimistic updates — resets only when a different item is opened
  const [local, setLocal] = useState(item);
  useEffect(() => { setLocal(item); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const org = data.ORG || '';
  const adoWIUrl = org && item.project
    ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(item.project.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}/_workitems/edit/${item.id}`
    : null;

  const nexusMDStateMap = { 'Active':'In Progress','New':'To Do','Resolved':'Done','Closed':'Done' };

  const patch = async (fieldOps, localPatch) => {
    const prev = local;
    setLocal(l => ({ ...l, ...localPatch }));
    try {
      await patchFields(item.id, fieldOps.map(([path, value]) => ({ op: 'add', path, value })));
      setWorkItems?.(arr => arr.map(w => w.id===item.id ? { ...w, ...localPatch } : w));
      toast?.('Saved', 'success');
    } catch(e) {
      setLocal(prev);
      toast?.('✗ ' + e.message, 'error');
    }
  };

  const assignee = TEAM.find(t => t.id === local.assignee);

  // Inline select style — transparent until interacted with
  const sel = {
    background:'transparent', border:'1px solid transparent', borderRadius:5,
    padding:'1px 18px 1px 3px', fontSize:13, color:'var(--text)',
    cursor:'pointer', appearance:'none',
    backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%238a857d' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat:'no-repeat', backgroundPosition:'right 3px center',
    outline:'none', fontFamily:'var(--sans)', maxWidth:'100%',
  };

  return (
    <div>
      <div className="drawer-section">
        <div style={{display:'flex',gap:8,marginBottom:4,flexWrap:'wrap',alignItems:'center'}}>
          <ProjectChip id={item.project}/>
          {adoWIUrl && <a href={adoWIUrl} target="_blank" rel="noopener" className="btn sm ghost" style={{marginLeft:'auto',textDecoration:'none'}}><Icon name="link" size={12}/> ADO</a>}
        </div>
        {local.blocker&&(
          <div style={{background:'var(--danger-soft)',color:'var(--danger)',padding:12,borderRadius:8,marginTop:8}}>
            <div style={{fontWeight:600,fontSize:12,display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
              <Icon name="alert" size={12}/> Blocked
            </div>
            <div style={{fontSize:13}}>{local.blocker}</div>
          </div>
        )}
      </div>
      <div className="drawer-section">
        <h4>Details</h4>
        <dl className="kv">
          <dt>State</dt>
          <dd>
            <select value={local.state||''} style={sel}
              onChange={e => { const v=e.target.value; patch([['/fields/System.State',v]],{state:nexusMDStateMap[v]||v}); }}>
              {(STATES||[]).map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </dd>

          <dt>Assignee</dt>
          <dd>
            <select value={assignee?.name||''} style={sel}
              onChange={e => {
                const name=e.target.value;
                const member=TEAM.find(t=>t.name===name);
                patch([['/fields/System.AssignedTo',name||'']],{assignee:member?.id||null});
              }}>
              <option value="">Unassigned</option>
              {TEAM.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </dd>

          <dt>Priority</dt>
          <dd>
            <select value={String(local.priority||3)} style={sel}
              onChange={e => { const v=parseInt(e.target.value,10); patch([['/fields/Microsoft.VSTS.Common.Priority',v]],{priority:v}); }}>
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{p}{PRIORITY_LABELS[p] ? ` – ${PRIORITY_LABELS[p]}` : ''}</option>
              ))}
            </select>
          </dd>

          <dt>Area</dt>
          <dd>
            <DataAreaTreePicker compact value={local.area||''}
              onChange={val => patch([['/fields/Custom.Area',val]],{area:val})}/>
          </dd>

          <dt>Tags</dt>
          <dd>
            <DataTagInput
              value={(local.tags||[]).join('; ')}
              onChange={str => {
                const tags=str.split(';').map(t=>t.trim()).filter(Boolean);
                patch([['/fields/System.Tags',str.trim()]],{tags});
              }}
              style={{background:'var(--surface-2)',border:'1px solid var(--border)',borderRadius:6,minHeight:28,padding:'1px 6px'}}
            />
          </dd>

          <dt>Points</dt><dd className="mono">{local.points||'—'}</dd>
          <dt>Sprint</dt><dd>{local.sprint?'Current Sprint':'—'}</dd>
          <dt>Updated</dt><dd>
            {local.updated} ago
            {local.changedMs && <span style={{display:'block',fontSize:11,color:'var(--text-subtle)',marginTop:1}}>{new Date(local.changedMs).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</span>}
          </dd>
        </dl>
      </div>
      <WorkItemDetail id={item.id} project={item.project}/>
    </div>
  );
}

// ── PersonDetail ──────────────────────────────────────────────────────────────
// confidential = { load(), hash(password) } for the host's notes lock.
export function PersonDetail({ dev, plannerData, confidential }) {
  const { data } = useNexusData()
  const { WORK_ITEMS, PRS, PLANNER_NOW } = data;
  const wis  = (WORK_ITEMS||[]).filter(w=>w.assignee===dev.id);
  const myPRs = (PRS||[]).filter(p=>p.author===dev.id);
  const myOneOnOne = (PLANNER_NOW?.oneOnOnes||[]).find(o=>o.person?.toLowerCase().includes((dev.name||'').split(' ')[0].toLowerCase()));
  const myNotes = ((plannerData?.teamNotes) || []).filter(n =>
    n.person?.toLowerCase() === (dev.name || '').toLowerCase()
  );

  // 'locked' | 'prompting' | 'revealed'
  const [notesState, setNotesState] = React.useState('locked');
  const [pwInput, setPwInput]       = React.useState('');
  const [pwErr, setPwErr]           = React.useState('');
  const [pwBusy, setPwBusy]         = React.useState(false);

  // Reset lock when switching between team members
  React.useEffect(() => {
    setNotesState('locked');
    setPwInput('');
    setPwErr('');
  }, [dev.id]);

  const confCfg    = confidential.load() || { hash: null };
  const hasPassword = !!confCfg.hash;

  const handleRevealClick = () => {
    if (!hasPassword) { setNotesState('revealed'); return; }
    setNotesState('prompting');
  };

  const handlePasswordSubmit = async () => {
    if (!pwInput) { setPwErr('Enter your password.'); return; }
    setPwBusy(true);
    try {
      const hash = await confidential.hash(pwInput);
      if (hash === confCfg.hash) {
        setNotesState('revealed');
        setPwErr('');
      } else {
        setPwErr('Incorrect password.');
      }
    } finally {
      setPwBusy(false);
    }
  };

  const inputStyle = { width:'100%', padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface)', fontSize:13, outline:'none', color:'var(--text)', boxSizing:'border-box' };

  return (
    <div>
      <div className="drawer-section" style={{display:'flex',alignItems:'center',gap:14}}>
        <Avatar who={dev.id} size="lg"/>
        <div>
          <div style={{fontWeight:600,fontSize:16}}>{dev.name}</div>
          <div className="muted" style={{fontSize:12.5}}>{dev.role} · {dev.tz}</div>
          <div style={{marginTop:4,fontSize:12,color:'var(--text-muted)'}}>{dev.focus}</div>
        </div>
      </div>
      <div className="drawer-section">
        <h4>Active work ({wis.filter(w=>!isTerminalState(w.state)).length})</h4>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {wis.filter(w=>!isTerminalState(w.state)).map(w=>(
            <div key={w.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'var(--surface-2)',borderRadius:6,fontSize:12.5}}>
              <TypeIcon type={w.type}/>
              <span className="mono muted" style={{fontSize:11}}>#{w.id}</span>
              <span style={{flex:1,minWidth:0}} className="truncate">{w.title}</span>
              <StateDot state={w.state}/>
            </div>
          ))}
          {wis.filter(w=>!isTerminalState(w.state)).length===0&&<div className="empty">No active work</div>}
        </div>
      </div>
      <div className="drawer-section">
        <h4>Open PRs ({myPRs.filter(p=>p.status==='active').length})</h4>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {myPRs.filter(p=>p.status==='active').map(p=>(
            <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background:'var(--surface-2)',borderRadius:6,fontSize:12.5}}>
              <Icon name="pr" size={13} style={{color:'var(--success)'}}/>
              <span className="mono muted" style={{fontSize:11}}>#{p.id}</span>
              <span style={{flex:1,minWidth:0}} className="truncate">{p.title}</span>
            </div>
          ))}
          {myPRs.filter(p=>p.status==='active').length===0&&<div className="empty">No open PRs</div>}
        </div>
      </div>
      <div className="drawer-section">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <h4 style={{ margin:0 }}>Notes ({myNotes.length})</h4>
          {myNotes.length > 0 && notesState === 'revealed' && (
            <button className="btn sm ghost" style={{ fontSize:11 }} onClick={() => setNotesState('locked')}>
              <Icon name="lock" size={11}/> Lock
            </button>
          )}
        </div>

        {myNotes.length === 0 ? (
          <div className="empty">No notes yet — use + Note on the Team page to add one.</div>

        ) : notesState === 'locked' ? (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', background:'var(--surface-2)', borderRadius:8, color:'var(--text-subtle)', fontSize:13 }}>
              <Icon name="lock" size={13}/>
              <span>{myNotes.length} confidential note{myNotes.length !== 1 ? 's' : ''}</span>
            </div>
            <button className="btn sm ghost" style={{ alignSelf:'flex-start', gap:6 }} onClick={handleRevealClick}>
              <Icon name="lock" size={11}/> {hasPassword ? 'Unlock to view' : 'Reveal'}
            </button>
          </div>

        ) : notesState === 'prompting' ? (
          <div style={{ display:'flex', flexDirection:'column', gap:10, padding:'14px', background:'var(--surface-2)', borderRadius:10, border:'1px solid var(--border)' }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', display:'flex', alignItems:'center', gap:7 }}>
              <Icon name="lock" size={13}/> Enter confidential password
            </div>
            <input
              type="password"
              value={pwInput}
              autoFocus
              onChange={e => { setPwInput(e.target.value); setPwErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handlePasswordSubmit(); if (e.key === 'Escape') setNotesState('locked'); }}
              placeholder="Password"
              style={inputStyle}
            />
            {pwErr && <div style={{ fontSize:12, color:'var(--danger)', padding:'5px 8px', background:'var(--danger-soft)', borderRadius:6 }}>{pwErr}</div>}
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn sm primary" onClick={handlePasswordSubmit} disabled={pwBusy} style={{ flex:1 }}>
                {pwBusy ? 'Checking…' : 'Unlock'}
              </button>
              <button className="btn sm ghost" onClick={() => { setNotesState('locked'); setPwInput(''); setPwErr(''); }}>Cancel</button>
            </div>
          </div>

        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {[...myNotes].reverse().map((n, i) => (
              <div key={i} style={{ padding:'8px 10px', background:'var(--surface-2)', borderRadius:6, borderLeft:'3px solid var(--accent)' }}>
                <div style={{ fontSize:13, color:'var(--text)', marginBottom:4 }}>{n.note}</div>
                <div className="muted" style={{ fontSize:11 }}>{n.date}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── DetailDrawer ──────────────────────────────────────────────────────────────
export function DetailDrawer({ drawer, onClose, setWorkItems, team: teamProp, plannerData, patchFields, confidential, PRDetail }) {
  const { data } = useNexusData()
  const open = drawer!=null;
  const kind = drawer?.kind;
  const d    = drawer?.data;
  const TEAM = teamProp || data.TEAM || [];

  const title = !d?'': kind==='wi'?d.title: kind==='pr'?d.title: kind==='person'?d.name: kind==='build'?`${d.pipeline} #${d.id}`:'';

  return (
    <Drawer open={open} onClose={onClose} title={title}
      badges={d&&kind==='wi'?(
        <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
          {data.ORG && d.project
            ? <a href={`https://dev.azure.com/${encodeURIComponent(data.ORG)}/${encodeURIComponent(d.project.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()))}/_workitems/edit/${d.id}`}
                 target="_blank" rel="noopener"
                 className="mono muted" style={{fontSize:11.5,color:'var(--accent)',textDecoration:'none'}}>#{d.id}</a>
            : <span className="mono muted" style={{fontSize:11.5}}>#{d.id}</span>}
          <TypeIcon type={d.type}/><Prio p={d.priority}/>
        </span>
      ):d&&kind==='pr'?(
        <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
          <span className="mono muted" style={{fontSize:11.5}}>#{d.id}</span>
          {d.draft&&<span className="pill" style={{fontSize:10}}>DRAFT</span>}
        </span>
      ):null}
      actions={d&&kind==='wi'?(
        <button className="btn sm ghost" onClick={()=>{setWorkItems(arr=>arr.map(w=>w.id===d.id?{...w,state:'Done'}:w));onClose();}}>
          <Icon name="check" size={13}/> Mark done
        </button>
      ):null}>
      {kind==='wi'&&d&&<WIDetail item={d} setWorkItems={setWorkItems} team={TEAM} patchFields={patchFields}/>}
      {kind==='pr'&&d&&<PRDetail pr={d} onClose={onClose}/>}
      {kind==='person'&&d&&<PersonDetail dev={d} plannerData={plannerData} confidential={confidential}/>}
      {kind==='build'&&d&&<BuildDetail build={d}/>}
    </Drawer>
  );
}
