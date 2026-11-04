// sync-status-card.jsx — Data & sync: one row per live profile with when it last synced (or why its
// last sync failed), what the server refused, its open conflicts, and one Sync now for all of them
// (a sync round covers every profile). Reads the account sync from useAccount(); signed out, it
// only says so.
import React from 'react';
import { useAccount, accountErrorMessage } from './account-gate.jsx';
import { useProfile } from './profile-context.jsx';
import { VsCard } from './views/view-settings.jsx';

const { useState, useEffect, useCallback } = React;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function when(t) {
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `today ${time}` : `${d.toLocaleDateString()} ${time}`;
}

export function SyncStatusCard() {
  const { sync } = useAccount();
  const profileApi = useProfile();
  const [status, setStatus] = useState(null); // read in the effect below
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(() => { if (sync && typeof sync.status === 'function') setStatus(sync.status()); }, [sync]);
  useEffect(() => {
    refresh();
    if (!sync || typeof sync.onApplied !== 'function') return undefined;
    return sync.onApplied(refresh);
  }, [sync, refresh]);

  if (!sync) {
    return (
      <VsCard title="Profile sync" icon="inbox" flush={false}>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Sign in to an account to sync your profiles between computers.</div>
      </VsCard>
    );
  }

  const syncNow = async () => {
    setBusy(true); setMsg('');
    const r = await sync.syncNow();
    if (r && r.error) setMsg(accountErrorMessage(r.error));
    refresh();
    setBusy(false);
  };

  const rows = (profileApi?.profiles || []).map((p) => ({ p, s: status?.profiles?.[p.id] }));
  return (
    <VsCard title="Profile sync" icon="inbox"
      actions={<button className="btn sm" disabled={busy} onClick={syncNow}>{busy ? 'Syncing…' : 'Sync now'}</button>}>
      {rows.map(({ p, s }) => {
        const notes = [];
        if (s?.conflicts) notes.push(plural(s.conflicts, 'conflict'));
        if (s?.tooLarge?.length) notes.push(`${plural(s.tooLarge.length, 'item')} too large to sync`);
        if (s?.quota?.length) notes.push(`${plural(s.quota.length, 'item')} over the account's storage limit`);
        return (
          <div key={p.id} className="set-row" data-testid={`sync-row-${p.id}`}>
            <div className="info">
              <div className="t">{p.name}</div>
              <div className="d">
                {s?.error
                  ? <span style={{ color: 'var(--danger, #c33)' }}>Last sync failed: {s.error}</span>
                  : s?.lastSyncAt ? `Last synced ${when(s.lastSyncAt)}` : 'Not synced yet'}
                {notes.length > 0 && <span> · {notes.join(' · ')}</span>}
              </div>
            </div>
          </div>
        );
      })}
      {msg && <div className="set-row" role="alert"><div className="info"><div className="d">{msg}</div></div></div>}
    </VsCard>
  );
}
