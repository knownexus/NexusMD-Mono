// git-view.jsx — read-only repository browser (repos → branches → recent commits) for Android.
import React, { useState, useEffect } from 'react';
import { timeAgo } from '@nexusmd/core';
import { adoGet, getAdoConfig } from './ado-client.js';
import { listRepos, listBranches, listCommits } from './git-browser.js';

const errText = (e) => e?.message || String(e);
const selectStyle = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontSize: 14 };

export function GitView() {
  const [repos, setRepos] = useState(null);
  const [repo, setRepo] = useState(null);
  const [branches, setBranches] = useState(null);
  const [branch, setBranch] = useState(null);
  const [commits, setCommits] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listRepos(adoGet, getAdoConfig().projects || []).then(setRepos).catch(e => setError(errText(e)));
  }, []);

  const pickBranch = (r, name) => {
    setBranch(name); setCommits(null); setError('');
    listCommits(adoGet, r, name).then(setCommits).catch(e => setError(errText(e)));
  };
  const pickRepo = (r) => {
    setRepo(r); setBranch(null); setCommits(null); setBranches(null); setError('');
    listBranches(adoGet, r).then(bs => {
      setBranches(bs);
      const first = bs.find(b => b.isDefault) || bs[0];
      if (first) pickBranch(r, first.name);
    }).catch(e => setError(errText(e)));
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
        Read-only. Cloning, committing and pushing are available on the desktop app.
      </div>
      {error && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, background: 'var(--danger-soft)', color: 'var(--danger)' }}>{error}</div>}
      <select value={repo?.id || ''} style={selectStyle}
        onChange={e => { const r = (repos || []).find(x => x.id === e.target.value); if (r) pickRepo(r); }}>
        <option value="">{repos ? 'Choose a repository…' : 'Loading repositories…'}</option>
        {(repos || []).map(r => <option key={r.id} value={r.id}>{r.project} / {r.name}</option>)}
      </select>
      {repo && (
        <select value={branch || ''} onChange={e => pickBranch(repo, e.target.value)} disabled={!branches} style={selectStyle}>
          {!branches && <option>Loading branches…</option>}
          {(branches || []).map(b => <option key={b.name} value={b.name}>{b.name}{b.isDefault ? ' (default)' : ''}</option>)}
        </select>
      )}
      {branch && !commits && !error && <div className="muted" style={{ fontSize: 13 }}>Loading commits…</div>}
      {commits && (
        commits.length === 0
          ? <div className="muted" style={{ fontSize: 13 }}>No commits.</div>
          : <div className="m-card flush">
              {commits.map(c => (
                <div key={c.id} style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{c.message || '(no message)'}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    <span className="mono">{c.shortId}</span> · {c.author} · {timeAgo(c.date)}
                  </div>
                </div>
              ))}
            </div>
      )}
    </div>
  );
}
