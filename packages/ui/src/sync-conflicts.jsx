// sync-conflicts.jsx — Data & sync: the conflict queue (values changed on two devices between syncs,
// core account-sync conflicts()). Each conflict opens a dialog: text (a note's body, a document,
// a plain string) gets a line diff with "Use mine / Use theirs" per changed hunk and an editable
// result; structured values (a time-log entry, a list, a connection) get a table of the differing
// fields with a choice each. Records can also be kept both ways (the other device's version as a
// "conflicted copy"). A deletion on one side, or a token (values never shown), offers either version.
import React from 'react';
import { diffLines } from '@nexusmd/core';
import { useAccount, accountErrorMessage, syncItemLabel } from './account-gate.jsx';
import { useProfile } from './profile-context.jsx';
import { PlModal } from './planner-chips.jsx';
import { VsCard } from './views/view-settings.jsx';

const { useState, useEffect, useCallback, useMemo } = React;

const TEXT_FIELDS = ['body', 'content', 'text'];
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const parse = (raw) => { try { return JSON.parse(raw); } catch { return undefined; } };
const show = (v) => (v === undefined ? '(none)' : typeof v === 'string' ? v : JSON.stringify(v));
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** How a conflict can be merged: { mode: 'text', field?, mine, theirs } | { mode: 'fields', mine, theirs } | { mode: 'choice' }. */
function shapeOf(c) {
  if (c.kind === 'secret' || c.local.deleted || c.remote.deleted) return { mode: 'choice' };
  const mine = c.kind === 'plain' && parse(c.local.value) === undefined ? c.local.value : parse(c.local.value);
  const theirs = c.kind === 'plain' && parse(c.remote.value) === undefined ? c.remote.value : parse(c.remote.value);
  if (typeof mine === 'string' && typeof theirs === 'string') return { mode: 'text', mine, theirs };
  if (isObj(mine) && isObj(theirs)) {
    const field = TEXT_FIELDS.find((f) => typeof mine[f] === 'string' && typeof theirs[f] === 'string' && mine[f] !== theirs[f]);
    const others = Object.keys({ ...mine, ...theirs }).filter((k) => k !== field && !sameValue(mine[k], theirs[k]));
    if (field && others.length === 0) return { mode: 'text', field, mine, theirs };
    return { mode: 'fields', mine, theirs };
  }
  return { mode: 'fields', mine: { value: mine }, theirs: { value: theirs }, single: true };
}

/** The diff as unchanged lines and changed hunks: [{ same: string[] } | { mine: string[], theirs: string[] }]. */
function hunksOf(mineText, theirsText) {
  const diff = diffLines(mineText, theirsText) || [{ t: '-', v: mineText }, { t: '+', v: theirsText }];
  const out = [];
  for (const d of diff) {
    const last = out[out.length - 1];
    if (d.t === '=') { if (last && last.same) last.same.push(d.v); else out.push({ same: [d.v] }); continue; }
    const hunk = last && !last.same ? last : (out.push({ mine: [], theirs: [] }), out[out.length - 1]);
    (d.t === '-' ? hunk.mine : hunk.theirs).push(d.v);
  }
  return out;
}

const textOf = (hunks, picks) => hunks
  .flatMap((h, i) => (h.same ? h.same : picks[i] === 'theirs' ? h.theirs : h.mine))
  .join('\n');

function Pick({ name, value, onChange }) {
  return (
    <span style={{ display: 'inline-flex', gap: 10 }}>
      <label><input type="radio" name={name} checked={value === 'mine'} onChange={() => onChange('mine')} /> Use mine</label>
      <label><input type="radio" name={name} checked={value === 'theirs'} onChange={() => onChange('theirs')} /> Use theirs</label>
    </span>
  );
}

const pre = { margin: 0, padding: '4px 8px', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 };

function TextMerge({ shape, onValue }) {
  const mineText = shape.field ? shape.mine[shape.field] : shape.mine;
  const theirsText = shape.field ? shape.theirs[shape.field] : shape.theirs;
  const hunks = useMemo(() => hunksOf(mineText, theirsText), [mineText, theirsText]);
  const [picks, setPicks] = useState({});
  const [edited, setEdited] = useState(null);
  const result = edited ?? textOf(hunks, picks);
  useEffect(() => { onValue(shape.field ? { ...shape.mine, [shape.field]: result } : result); }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {hunks.map((h, i) => (h.same ? null : (
        <div key={i} data-testid="conflict-hunk" style={{ border: '1px solid var(--border)', borderRadius: 6 }}>
          <pre style={{ ...pre, background: 'var(--danger-soft, #fde8e8)' }}>{h.mine.join('\n') || '(nothing)'}</pre>
          <pre style={{ ...pre, background: 'var(--success-soft, #e6f6ea)' }}>{h.theirs.join('\n') || '(nothing)'}</pre>
          <div style={{ padding: '4px 8px' }}>
            <Pick name={`hunk-${i}`} value={picks[i] || 'mine'} onChange={(v) => { setEdited(null); setPicks({ ...picks, [i]: v }); }} />
          </div>
        </div>
      )))}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Result
        <textarea aria-label="Result" rows={8} value={result} onChange={(e) => setEdited(e.target.value)} style={{ fontFamily: 'var(--font-mono, monospace)' }} />
      </label>
    </div>
  );
}

function FieldMerge({ shape, onValue }) {
  const keys = Object.keys({ ...shape.mine, ...shape.theirs }).filter((k) => !sameValue(shape.mine[k], shape.theirs[k]));
  const [picks, setPicks] = useState({});
  useEffect(() => {
    const out = { ...shape.mine };
    for (const k of keys) {
      if (picks[k] !== 'theirs') continue;
      if (shape.theirs[k] === undefined) delete out[k]; else out[k] = shape.theirs[k];
    }
    onValue(shape.single ? out.value : out);
  }, [picks]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
      <thead><tr><th align="left">Field</th><th align="left">This device</th><th align="left">Other device</th><th /></tr></thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} data-testid="conflict-field" data-field={k}>
            <td>{shape.single ? 'Value' : k}</td><td>{show(shape.mine[k])}</td><td>{show(shape.theirs[k])}</td>
            <td><Pick name={`field-${k}`} value={picks[k] || 'mine'} onChange={(v) => setPicks({ ...picks, [k]: v })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

export function ConflictDialog({ conflict: c, profileName, deviceName, sync, onClose, onDone }) {
  const shape = useMemo(() => shapeOf(c), [c]);
  const [value, setValue] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn) => {
    setBusy(true); setError('');
    const r = await fn();
    setBusy(false);
    if (r && r.error) {
      setError(r.error.code === 'conflict'
        ? 'This changed again on another computer. Load that profile from the server, then resolve it again.'
        : accountErrorMessage(r.error));
      return;
    }
    onDone();
  };
  const take = (side) => run(() => sync.resolve(c.id, { take: side }));
  const save = () => run(() => sync.resolve(c.id, { value: typeof value === 'string' && c.kind === 'plain' ? value : JSON.stringify(value) }));
  const keepBoth = () => run(() => sync.keepBoth(c.id, { copyName: (n) => `${n} (conflicted copy, ${deviceName}, ${today()})` }));
  const isRecord = c.kind === 'record' && !c.local.deleted && !c.remote.deleted;

  const footer = (
    <>
      {isRecord && <button className="btn sm ghost" disabled={busy} onClick={keepBoth}>Keep both</button>}
      {shape.mode !== 'choice' && <button className="btn sm primary" disabled={busy || value === undefined} onClick={save}>Save</button>}
    </>
  );
  return (
    <PlModal open onClose={onClose} title="Sync conflict" sub={`${profileName} · ${syncItemLabel(c.id)}`} wide footer={footer}>
      {shape.mode === 'choice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p>
            {c.kind === 'secret'
              ? 'A saved sign-in or token was changed on this device and on another one.'
              : c.remote.deleted ? 'This was changed here and deleted on the other device.'
                : 'This was deleted here and changed on the other device.'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" disabled={busy} onClick={() => take('local')}>Keep this device&apos;s version</button>
            <button className="btn sm" disabled={busy} onClick={() => take('remote')}>Use the other device&apos;s version</button>
          </div>
        </div>
      )}
      {shape.mode === 'text' && <TextMerge shape={shape} onValue={setValue} />}
      {shape.mode === 'fields' && <FieldMerge shape={shape} onValue={setValue} />}
      {error && <p role="alert" style={{ color: 'var(--danger, #c33)' }}>{error}</p>}
    </PlModal>
  );
}

/** `account` (optional) gives the device name for conflicted copies (account.deviceNameDefault()). */
export function SyncConflictsCard({ account = null }) {
  const { sync } = useAccount();
  const profileApi = useProfile();
  const [list, setList] = useState(() => (sync && typeof sync.conflicts === 'function' ? sync.conflicts() : []));
  const [open, setOpen] = useState(null);
  const refresh = useCallback(() => { if (sync && typeof sync.conflicts === 'function') setList(sync.conflicts()); }, [sync]);
  useEffect(() => {
    if (!sync || typeof sync.onConflict !== 'function') return undefined;
    return sync.onConflict(refresh);
  }, [sync, refresh]);
  if (!sync || typeof sync.conflicts !== 'function') return null;

  const all = [...(profileApi?.profiles || []), ...(profileApi?.deletedProfiles || [])];
  const nameOf = (pid) => all.find((p) => p.id === pid)?.name || pid || 'Shared';
  const deviceName = (account && typeof account.deviceNameDefault === 'function' && account.deviceNameDefault()) || 'this device';
  return (
    <VsCard title="Sync conflicts" icon="inbox">
      {list.length === 0 && (
        <div className="set-row"><div className="info"><div className="d">No sync conflicts. Changes made on two computers at once show up here for you to decide.</div></div></div>
      )}
      {list.map((c) => (
        <div key={c.id} className="set-row">
          <div className="info">
            <div className="t">{nameOf(c.profileId)} · {syncItemLabel(c.id)}</div>
            <div className="d">Changed on this computer and another one{c.detectedAt ? ` (found ${new Date(c.detectedAt).toLocaleString()})` : ''}</div>
          </div>
          <button className="btn sm" onClick={() => setOpen(c)}>Resolve</button>
        </div>
      ))}
      {open && (
        <ConflictDialog conflict={open} profileName={nameOf(open.profileId)} deviceName={deviceName} sync={sync}
          onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />
      )}
    </VsCard>
  );
}
