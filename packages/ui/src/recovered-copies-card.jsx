// recovered-copies-card.jsx — Data & sync: the damaged copies the app set aside. When a saved planner week, the
// notes, the time log or the offline queue could not be read, the app opened it empty and kept the unreadable text
// (see @nexusmd/core readJsonKeepingDamaged). It is not valid data, so it cannot be put back as it is: this card
// lets the text be saved to a file to look at, or removed. Shows nothing when there is no copy.
import React from 'react';
import { listDamagedCopies, discardDamagedCopy, rendererLog, ignore } from '@nexusmd/core';
import { useProfile } from './profile-context.jsx';
import { VsCard, VsRow } from './views/view-settings.jsx';

const log = rendererLog('core', 'recovered-copies');
const { useState, useCallback } = React;

export function copyLabel({ collection, item }) {
  if (collection === 'planner') return `Planner week ${item}`;
  if (collection === 'notes') return 'Planner notes';
  if (collection === 'timelog.v1') return 'Time log';
  if (collection === 'offline-queue') return 'Offline queue';
  return item === 'data' ? collection : `${collection} ${item}`;
}

const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const kb = (n) => (n < 1024 ? `${n} characters` : `${(n / 1024).toFixed(1)} KB`);

/**
 * @param {{ fileIO: { saveFile: (name: string, text: string) => Promise<any> }, namespace?: string, storage?: Storage }} props
 */
export function RecoveredCopiesCard({ fileIO, namespace = 'nexusmd', storage }) {
  const { activeId } = useProfile() || {};
  const store = storage || (typeof window !== 'undefined' ? window.localStorage : null);
  const [tick, setTick] = useState(0);
  const [asking, setAsking] = useState(null); // key of the copy waiting for a second click
  const [msg, setMsg] = useState('');
  const copies = store && activeId ? listDamagedCopies({ storage: store, namespace, profileId: activeId }) : [];
  void tick;

  const save = useCallback(async (c) => {
    setMsg('');
    try {
      const name = `${namespace}-damaged-${c.collection.replace(/[^a-z0-9]+/gi, '-')}-${c.item.replace(/[^a-z0-9]+/gi, '-')}-${c.at}.txt`.toLowerCase();
      await fileIO.saveFile(name, store.getItem(c.key) || '');
    } catch (err) {
      ignore(log, 'a kept damaged copy could not be saved to a file', err, 'warn', { collection: c.collection });
      setMsg(`${copyLabel(c)} could not be saved to a file.`);
    }
  }, [fileIO, store, namespace]);

  const remove = (c) => {
    if (discardDamagedCopy(store, c.key)) { setAsking(null); setTick((n) => n + 1); }
    else setMsg(`${copyLabel(c)} could not be removed.`);
  };

  if (!copies.length) return null;
  return (
    <VsCard title="Recovered copies" icon="inbox" flush>
      <VsRow title="Set aside because they could not be read"
        desc="The app opened these empty and kept the text. It is damaged, so it cannot be put back as it is. Save one to look through it, or remove it. They stay on this computer and are deleted with the profile." />
      {msg && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger, #c0392b)', padding: '0 14px 8px' }}>{msg}</div>}
      {copies.map((c) => (
        <VsRow key={c.key} title={copyLabel(c)} desc={`${when(c.at)} · ${kb(c.size)}`}>
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm" aria-label={`Save ${copyLabel(c)} as file`} onClick={() => save(c)}>Save as file</button>
            {asking === c.key
              ? <button className="btn sm danger" onClick={() => remove(c)}>Remove for good</button>
              : <button className="btn sm" aria-label={`Remove ${copyLabel(c)}`} onClick={() => setAsking(c.key)}>Remove</button>}
          </span>
        </VsRow>
      ))}
    </VsCard>
  );
}
