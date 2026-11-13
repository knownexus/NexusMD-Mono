// sync-status-card.jsx — Data & sync: one row per live profile, which says which account and server it goes
// to, when it was last saved to / loaded from the server (or why the last sync failed), what the server refused,
// its open conflicts, and two buttons that act on that profile alone:
//   Save to server    sends what changed on this device
//   Load from server  brings down what the server has newer
// Neither overwrites the other side: a clash becomes a conflict to decide (see sync-conflicts.jsx). Background
// sync still runs by itself. Reads the account sync from useAccount(); signed out, it only says so.
import React from 'react';
import { ignore, rendererLog } from '@nexusmd/core';
import { useAccount, accountErrorMessage } from './account-gate.jsx';
import { useProfile } from './profile-context.jsx';
import { VsCard } from './views/view-settings.jsx';

const { useState, useEffect, useCallback } = React;

const log = rendererLog('ui', 'sync-status');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function when(t) {
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `today ${time}` : `${d.toLocaleDateString()} ${time}`;
}

// The app reloads the moment a load applies something (see AccountGate), which would wipe what the row says, so
// what to say is kept for after the reload: one message, for one profile, read once.
const NOTICE_KEY = 'nexusmd.sync.notice';
function peekNotice() {
  try {
    const n = JSON.parse(sessionStorage.getItem(NOTICE_KEY) || 'null');
    return n && typeof n.profileId === 'string' && typeof n.text === 'string' ? n : null;
  } catch (err) { ignore(log, 'session storage is unavailable, so there is no message to show', err, 'debug'); return null; }
}
function writeNotice(n) {
  try { if (n) sessionStorage.setItem(NOTICE_KEY, JSON.stringify(n)); else sessionStorage.removeItem(NOTICE_KEY); } catch (err) { ignore(log, 'session storage is unavailable', err, 'debug'); }
}

// What a finished save or load says about a profile: { text, bad }.
function outcome(kind, profile, r) {
  if (r && r.error) return { text: accountErrorMessage(r.error), bad: true };
  if (kind === 'save') {
    const sent = (r && r.pushed) || 0;
    const clashed = (r && r.conflicts) || 0;
    if (clashed) {
      return {
        text: `${sent ? `${plural(sent, 'item')} of ${profile.name} sent. ` : ''}${plural(clashed, 'item')} clashed with the server's copy and ${clashed === 1 ? 'needs' : 'need'} your decision under Sync conflicts.`,
        bad: true,
      };
    }
    return { text: sent ? `Saved ${profile.name} to the server: ${plural(sent, 'item')} sent.` : `Nothing new to save for ${profile.name}.` };
  }
  const applied = (r && r.applied) || 0;
  return { text: applied ? `Loaded ${profile.name} from the server: ${plural(applied, 'change')} applied.` : `${profile.name} is already up to date with the server.` };
}

export function SyncStatusCard() {
  const { sync, session, serverName } = useAccount();
  const profileApi = useProfile();
  const [status, setStatus] = useState(null); // read in the effect below
  const [running, setRunning] = useState(null); // { pid, kind } while a save or load is under way
  const [notes, setNotes] = useState(() => { const n = peekNotice(); return n ? { [n.profileId]: { text: n.text } } : {}; });

  const refresh = useCallback(() => { if (sync && typeof sync.status === 'function') setStatus(sync.status()); }, [sync]);
  useEffect(() => {
    refresh();
    if (!sync || typeof sync.onApplied !== 'function') return undefined;
    return sync.onApplied(refresh);
  }, [sync, refresh]);
  useEffect(() => { writeNotice(null); }, []); // read above, once

  if (!sync) {
    return (
      <VsCard title="Profile sync" icon="inbox" flush={false}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Sign in to an account to sync your profiles between computers.</div>
      </VsCard>
    );
  }

  const say = (pid, note) => setNotes(prev => ({ ...prev, [pid]: note }));
  const run = async (kind, profile) => {
    setRunning({ pid: profile.id, kind }); say(profile.id, null);
    let off = null;
    if (kind === 'load' && typeof sync.onApplied === 'function') {
      // Runs after the gate's own listener has started the reload, in the same turn, so the message is saved in time.
      off = sync.onApplied(({ applied } = {}) => writeNotice({ profileId: profile.id, text: outcome('load', profile, { applied }).text }));
    }
    try {
      const r = kind === 'save' ? await sync.push({ profileId: profile.id }) : await sync.pull({ profileId: profile.id });
      say(profile.id, outcome(kind, profile, r));
    } catch (e) {
      log.warn(`${kind === 'save' ? 'saving' : 'loading'} a profile ${kind === 'save' ? 'to' : 'from'} the server failed`, e);
      say(profile.id, { text: accountErrorMessage(e), bad: true });
    } finally {
      if (off) off();
      refresh();
      setRunning(null);
    }
  };

  const activeId = profileApi?.activeId;
  const rows = (profileApi?.profiles || []).map((p) => ({ p, s: status?.profiles?.[p.id] }));
  return (
    <VsCard title="Profile sync" icon="inbox">
      <div className="set-row" data-testid="sync-target">
        <div className="info">
          <div className="t">{session ? `Signed in as ${session.username}` : 'Your account'}{serverName ? ` · ${serverName}` : ''}</div>
          <div className="d">
            Save sends this device's changes to your account; Load brings the account's newer changes here. Neither overwrites the other
            side: a clash is kept for you to decide. Syncing also happens by itself in the background.
          </div>
        </div>
      </div>
      {rows.map(({ p, s }) => {
        const notesOf = [];
        if (s?.conflicts) notesOf.push(plural(s.conflicts, 'conflict'));
        if (s?.tooLarge?.length) notesOf.push(`${plural(s.tooLarge.length, 'item')} too large to sync`);
        if (s?.quota?.length) notesOf.push(`${plural(s.quota.length, 'item')} over the account's storage limit`);
        if (s?.unreadable?.length) notesOf.push(`${plural(s.unreadable.length, 'item')} could not be read on this device`);
        const times = [];
        if (s?.lastSavedAt) times.push(`Saved to server ${when(s.lastSavedAt)}`);
        if (s?.lastLoadedAt) times.push(`Loaded from server ${when(s.lastLoadedAt)}`);
        if (s?.lastSyncAt) times.push(`Last synced ${when(s.lastSyncAt)}`);
        const note = notes[p.id];
        const mine = running && running.pid === p.id ? running.kind : null;
        return (
          <div key={p.id} className="set-row" data-testid={`sync-row-${p.id}`}>
            <div className="info">
              <div className="t">
                {p.name}
                {p.id === activeId && <span className="pill success" style={{ marginLeft: 8 }}><span className="dot"></span>Active</span>}
              </div>
              <div className="d">
                {s?.error
                  ? <span style={{ color: 'var(--danger, #c33)' }}>Last sync failed: {s.error}</span>
                  : times.length ? times.join(' · ') : 'Not synced yet'}
                {notesOf.length > 0 && <span> · {notesOf.join(' · ')}</span>}
              </div>
              {note && (
                <div className="d" role={note.bad ? 'alert' : 'status'} style={note.bad ? { color: 'var(--danger, #c33)' } : undefined}>{note.text}</div>
              )}
            </div>
            <button className="btn sm" disabled={!!running} aria-label={`Save ${p.name} to the server`}
              title="Send this profile's changes to your account. Nothing on the server is overwritten."
              onClick={() => run('save', p)}>{mine === 'save' ? 'Saving…' : 'Save to server'}</button>
            <button className="btn sm" disabled={!!running} aria-label={`Load ${p.name} from the server`}
              title="Bring this profile's newer changes down from your account. Your newer edits here are kept."
              onClick={() => run('load', p)}>{mine === 'load' ? 'Loading…' : 'Load from server'}</button>
          </div>
        );
      })}
      {status?.unreadable?.length > 0 && (
        <div className="set-row" data-testid="sync-unreadable">
          <div className="info">
            <div className="t" style={{ color: 'var(--danger, #c33)' }}>
              {plural(status.unreadable.length, 'item')} that {status.unreadable.length === 1 ? 'belongs' : 'belong'} to no profile could not be read on this device
            </div>
            <div className="d">{status.unreadable.length === 1 ? 'It was' : 'They were'} left alone, so the damage is not copied to your account or your other devices.</div>
          </div>
        </div>
      )}
    </VsCard>
  );
}
