// sync-summary.js — the account sync in one place for whoever shows it: how many changes are not saved to the server (per
// profile and in all), how many conflicts wait for a decision, the last error, and when it last synced. Used by the Data & sync
// card, the sidebar badge and the phone's settings summary, so they always agree.
//
// `known` is false until the first answer, and stays false when there is no account: callers show nothing, and never "Nothing to
// save", for a count they do not have. It is read again when a pull applies something, a conflict arrives, the window is focused,
// every `pollMs`, and when anything asks with refreshSyncSummary() (the card does after a save or load).
import React from 'react';
import { ignore, rendererLog } from '@nexusmd/core';
import { useAccount } from './account-gate.jsx';

const log = rendererLog('ui', 'sync-summary');
export const SYNC_SUMMARY_EVENT = 'nexusmd:sync-summary';
export const SYNC_SUMMARY_POLL_MS = 30000;

/** Asks every mounted useSyncSummary to read again (after a save, a load, a resolved conflict). */
export function refreshSyncSummary() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SYNC_SUMMARY_EVENT));
}

const EMPTY = { known: false, unsaved: { profiles: {}, unattributed: 0, total: 0 }, conflicts: 0, error: null, lastSyncAt: null };

async function read(sync) {
  const status = typeof sync.status === 'function' ? sync.status() : null;
  const unsaved = typeof sync.unsaved === 'function' ? await sync.unsaved() : null;
  const rows = Object.values((status && status.profiles) || {});
  return {
    known: !!unsaved,
    unsaved: unsaved || EMPTY.unsaved,
    conflicts: rows.reduce((n, r) => n + (r.conflicts || 0), 0),
    error: (rows.find((r) => r.error) || {}).error || null,
    lastSyncAt: (status && status.lastSyncAt) || null,
  };
}

export function useSyncSummary({ pollMs = SYNC_SUMMARY_POLL_MS } = {}) {
  const { sync } = useAccount();
  const [summary, setSummary] = React.useState(EMPTY);
  const alive = React.useRef(true);
  const refresh = React.useCallback(async () => {
    if (!sync) { if (alive.current) setSummary(EMPTY); return; }
    try {
      const next = await read(sync);
      if (alive.current) setSummary(next);
    } catch (err) { ignore(log, 'the sync summary could not be read, so the last one stays', err, 'debug'); }
  }, [sync]);

  React.useEffect(() => {
    alive.current = true;
    refresh();
    const offs = [];
    if (sync && typeof sync.onApplied === 'function') offs.push(sync.onApplied(refresh));
    if (sync && typeof sync.onConflict === 'function') offs.push(sync.onConflict(refresh));
    if (sync && typeof sync.onError === 'function') offs.push(sync.onError(refresh));
    window.addEventListener(SYNC_SUMMARY_EVENT, refresh);
    window.addEventListener('focus', refresh);
    const timer = pollMs > 0 && sync ? setInterval(refresh, pollMs) : null;
    return () => {
      alive.current = false;
      offs.forEach((off) => { if (typeof off === 'function') off(); });
      window.removeEventListener(SYNC_SUMMARY_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      if (timer) clearInterval(timer);
    };
  }, [sync, refresh, pollMs]);

  return { ...summary, refresh };
}
