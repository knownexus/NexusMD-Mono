// source-switch.jsx — show one provider at a time on Work, PRs, Builds and Tests. The hook picks and
// remembers the provider per screen and profile; the switch only renders when there is a choice.
import React from 'react';
import { getProfileKey } from './profile-keys.js';
import { SOURCE_LABELS, itemSource, sourcesIn, pickSource, filterBySource } from './source-filter.js';

const read = (screen) => { try { return localStorage.getItem(getProfileKey('helm.source.' + screen)); } catch { return null; } };

export function useSourceFilter(screen, list) {
  const [saved, setSaved] = React.useState(() => read(screen));
  const all = list || [];
  const sources = React.useMemo(() => sourcesIn(all), [all]);
  const source = pickSource(saved, sources);
  const setSource = (p) => {
    setSaved(p);
    try { localStorage.setItem(getProfileKey('helm.source.' + screen), p); } catch { /* ignore */ }
  };
  const filtered = React.useMemo(() => filterBySource(all, sources, source), [all, sources, source]);
  const counts = React.useMemo(() => Object.fromEntries(sources.map(p => [p, all.filter(x => itemSource(x) === p).length])), [all, sources]);
  return { sources, source, setSource, filtered, counts };
}

export function SourceSwitch({ sources, source, setSource, counts, style }) {
  if (!sources || sources.length < 2) return null;
  return (
    <div className="m-seg" role="tablist" aria-label="Source" style={{ marginBottom: 12, ...style }}>
      {sources.map(p => (
        <button key={p} type="button" role="tab" aria-selected={p === source} className={p === source ? 'active' : ''}
          onClick={() => setSource(p)}>
          {SOURCE_LABELS[p]} <span style={{ opacity: 0.6, fontSize: 11 }}>{counts[p]}</span>
        </button>
      ))}
    </div>
  );
}
