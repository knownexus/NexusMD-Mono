// dashboard-interactive-widgets.jsx — Home widgets you can act on: time, quick note, and the latest build and test
// run. Shared by the apps: they reach storage and app actions only through props (a timer store, a notes store,
// onCreateBug, an ArtifactsSheet component), so nothing here reads app globals or localStorage itself.
import React from 'react';
import { formatClock } from '@nexusmd/core';
import { Icon } from './icons.jsx';
import { runningEntries, startEntry, stopEntry, addMark, durationMs, emptyLog } from './views/time-log.js';
import { loadGlobalNotes, saveGlobalNotes } from './planner/planner-notes.jsx';

const { useState, useEffect } = React;
const field = { flex: 1, minWidth: 0, height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' };

/**
 * A timer store over any Storage-like object ({ getItem, setItem }). The apps pass their storage and the keys
 * (already profile-scoped); the widget only calls load/save/loadPaused/savePaused.
 */
export function storageTimerStore({ storage, logKey, pausedKey }) {
  return {
    load: () => { try { const r = storage.getItem(logKey); return r ? JSON.parse(r) : emptyLog(); } catch { return emptyLog(); } },
    save: (log) => { try { storage.setItem(logKey, JSON.stringify(log)); } catch { /* storage full */ } },
    loadPaused: () => { try { return JSON.parse(storage.getItem(pausedKey) || '[]'); } catch { return []; } },
    savePaused: (p) => { try { storage.setItem(pausedKey, JSON.stringify(p)); } catch { /* storage full */ } },
  };
}

// In-memory fallback so a host that supplies no timer store still renders a working (unsaved) widget.
function memoryTimerStore() {
  let log = emptyLog(); let paused = [];
  return { load: () => log, save: (l) => { log = l; }, loadPaused: () => paused, savePaused: (p) => { paused = p; } };
}

export function Card({ icon, title, meta, onMore, children }) {
  return (
    <div className="m-card" style={{ marginBottom: 12 }}>
      <div className="m-card-h">
        <span className="ic"><Icon name={icon} size={15}/></span>
        <h3>{title}</h3>
        {meta != null && <span className="meta">{meta}</span>}
        {onMore && <button type="button" className="m-linkbtn" onClick={onMore}>Open</button>}
      </div>
      {children && <div className="m-card-body flush">{children}</div>}
    </div>
  );
}

// Time: start, pause, resume, mark and stop timers in the log the Time page keeps. Pause stops the entry and offers
// Resume, which starts a new entry with the same label and ticket.
export function TimeWidget({ timer, navTo }) {
  const [fallback] = useState(memoryTimerStore);
  const store = timer || fallback;
  const [log, setLogRaw] = useState(() => store.load());
  const [label, setLabel] = useState('');
  const [paused, setPaused] = useState(() => store.loadPaused());
  const [now, setNow] = useState(Date.now());
  const running = runningEntries(log);
  const setLog = (fn) => {
    const next = fn(store.load());
    store.save(next);
    setLogRaw(next);
  };
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); setLogRaw(store.load()); }, 1000);
    return () => clearInterval(t);
  }, [store]);
  const savePaused = (p) => { setPaused(p); store.savePaused(p); };

  const start = (e = {}) => { setLog(l => startEntry(l, { ref: e.ref || null, label: e.label || label.trim() || 'Timer' }, Date.now())); setLabel(''); };
  const stop = (e) => setLog(l => stopEntry(l, e.id, Date.now()));
  const pause = (e) => {
    setLog(l => stopEntry(l, e.id, Date.now()));
    savePaused([{ ref: e.ref || null, label: e.label }, ...paused.filter(p => p.label !== e.label)].slice(0, 5));
  };
  const resume = (p) => { start(p); savePaused(paused.filter(x => x !== p)); };
  const mark = (e) => setLog(l => addMark(l, e.id, Date.now(), '', Date.now()));
  return (
    <Card icon="clock" title="Time" meta={running.length || null} onMore={() => navTo?.('time')}>
      {running.map(e => (
        <div key={e.id} className="m-row" style={{ cursor: 'default', flexWrap: 'wrap' }}>
          <div className="m-row-main">
            <div className="m-row-title">{e.label}</div>
            <div className="m-row-meta"><span className="m-id" style={{ fontFamily: 'var(--mono)', fontSize: 15 }}>{formatClock(durationMs(e, now))}</span></div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => pause(e)}><Icon name="pause" size={12}/> Pause</button>
            <button type="button" className="btn sm ghost" onClick={() => mark(e)}><Icon name="flag" size={12}/> Mark</button>
            <button type="button" className="btn sm ghost" onClick={() => stop(e)}><Icon name="x" size={12}/> Stop</button>
          </div>
        </div>
      ))}
      {paused.map((p, i) => (
        <div key={p.label + i} className="m-row" style={{ cursor: 'default' }}>
          <div className="m-row-main"><div className="m-row-title">{p.label}</div><div className="m-row-meta"><span className="m-id">Paused</span></div></div>
          <button type="button" className="btn sm primary" onClick={() => resume(p)}><Icon name="play" size={12}/> Resume</button>
          <button type="button" className="btn sm ghost" aria-label="Discard" onClick={() => savePaused(paused.filter(x => x !== p))}><Icon name="x" size={12}/></button>
        </div>
      ))}
      <form style={{ display: 'flex', gap: 8, padding: 12 }} onSubmit={e => { e.preventDefault(); start(); }}>
        <input style={field} value={label} placeholder="What are you working on?" onChange={e => setLabel(e.target.value)}/>
        <button type="submit" className="btn sm primary"><Icon name="play" size={12}/> Start</button>
      </form>
    </Card>
  );
}

const DEFAULT_NOTES = { load: loadGlobalNotes, save: saveGlobalNotes };

// Notes: type and save; it opens in the Notes page like any other note. `notes` is { load(), save(list) };
// it defaults to the shared planner global-notes store.
export function NotesWidget({ navTo, notes = DEFAULT_NOTES }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const save = (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    const at = new Date().toISOString();
    notes.save([{ id: 'gn' + Date.now(), title: body.split('\n')[0].slice(0, 80), body, createdAt: at, updatedAt: at, status: 'open', completedWeek: null }, ...(notes.load() || [])]);
    setText(''); setSaved(true); setTimeout(() => setSaved(false), 1500);
  };
  return (
    <Card icon="pin" title="Quick note" onMore={() => navTo?.('notes')}>
      <form style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'flex-end' }} onSubmit={save}>
        <textarea style={{ ...field, height: 64, padding: 10, resize: 'none' }} value={text} placeholder="Jot something down…" onChange={e => setText(e.target.value)}/>
        <button type="submit" className="btn sm primary" disabled={!text.trim()}>{saved ? 'Saved' : 'Save'}</button>
      </form>
    </Card>
  );
}

// Builds: the latest build up front, with what you can do to it. `ArtifactsSheet` ({ build, onClose }) and
// `onCreateBug(detail)` come from the app; without them the Artifacts and Bug buttons are not shown.
export function LatestBuild({ build, navTo, onCreateBug, ArtifactsSheet }) {
  const [artifacts, setArtifacts] = useState(null);
  if (!build) return null;
  const bad = build.status === 'failed' || build.status === 'cancelled';
  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
      <div className="m-row-sub" style={{ margin: 0 }}>Latest build</div>
      <div className="m-row-title">{build.pipeline || 'Pipeline'} <span className="m-id">#{build.number || build.id}</span></div>
      <div className="m-row-meta">
        <span className="m-id" style={{ color: build.status === 'failed' ? 'var(--danger)' : build.status === 'success' ? 'var(--success)' : undefined }}>{build.status}</span>
        {build.branch && <span className="m-id">{String(build.branch).replace(/^refs\/heads\//, '')}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn sm" onClick={() => navTo?.('builds')}>Open</button>
        {ArtifactsSheet && <button type="button" className="btn sm ghost" onClick={() => setArtifacts(build)}>Artifacts</button>}
        {bad && onCreateBug && <button type="button" className="btn sm ghost" onClick={() => onCreateBug({
          title: `Build ${build.status}: ${build.pipeline}`, tags: 'build;ci',
          description: `Build #${build.id}\nBranch: ${build.branch}\nReason: ${build.failureReason || build.status}`,
        })}><Icon name="plus" size={12}/> Bug</button>}
      </div>
      {ArtifactsSheet && <ArtifactsSheet build={artifacts} onClose={() => setArtifacts(null)}/>}
    </div>
  );
}

// Tests: the latest run up front.
export function LatestTest({ run, navTo, onCreateBug }) {
  if (!run) return null;
  const bad = run.result === 'failed';
  const name = run.name || run.title || run.pipeline || 'Test run';
  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
      <div className="m-row-sub" style={{ margin: 0 }}>Latest run</div>
      <div className="m-row-title">{name}</div>
      <div className="m-row-meta">
        <span className="m-id" style={{ color: bad ? 'var(--danger)' : undefined }}>{run.result || run.status || ''}</span>
        {run.total != null && <span className="m-id">{run.passed ?? 0}/{run.total} passed</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button type="button" className="btn sm" onClick={() => navTo?.('tests')}>Open</button>
        {bad && onCreateBug && <button type="button" className="btn sm ghost" onClick={() => onCreateBug({
          title: `Tests failed: ${name}`, tags: 'tests', description: `Run ${run.id || ''}\nResult: ${run.result}`,
        })}><Icon name="plus" size={12}/> Bug</button>}
      </div>
    </div>
  );
}
