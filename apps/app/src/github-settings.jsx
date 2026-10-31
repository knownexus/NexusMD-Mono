// github-settings.jsx — GitHub connection sheet: token, "Load GitHub issues", repository discovery
// (a searchable checklist grouped by owner) and Save. Same flow as the desktop card, phone sized.
import React, { useState, useEffect, useMemo } from 'react';
import { makeGithubClient, discoverGithubRepos, MAX_GITHUB_REPOS, GITHUB_CACHE_KEY } from '@nexusmd/core';
import { Icon } from './icons.jsx';
import { Sheet } from './components.jsx';
import { getGithubConfig, saveGithubConfig, createGithubHttpAdapter } from './github-client.js';

const defaultClient = (pat) => makeGithubClient(createGithubHttpAdapter({ getConfig: () => ({ pat }) }));

export function GithubSettingsModal({ open, onClose, onSaved, makeClient = defaultClient, discover = discoverGithubRepos }) {
  const [pat, setPat] = useState('');
  const [issues, setIssues] = useState(true);
  const [selected, setSelected] = useState([]);
  const [found, setFound] = useState(null); // { repos, ssoOrgs } after Discover
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!open) return;
    const c = getGithubConfig();
    setPat(''); setIssues(c.issues !== false); setSelected(c.repos || []);
    setFound(null); setSearch(''); setStatus(''); setBusy('');
  }, [open]);

  // The stored token is read when needed: a save made from this sheet stores one.
  const token = () => pat.trim() || getGithubConfig().pat || '';
  const overCap = selected.length > MAX_GITHUB_REPOS;

  const discoverRepos = async () => {
    if (!token()) { setStatus('Error: Enter a token first.'); return; }
    setBusy('discover'); setStatus('Discovering…');
    try {
      const result = await discover(makeClient(token()));
      setFound(result);
      setStatus(`Found ${result.repos.length} repositor${result.repos.length === 1 ? 'y' : 'ies'}.`);
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'Discovery failed'));
    } finally { setBusy(''); }
  };

  const save = async () => {
    if (overCap) return;
    if (!token()) { setStatus('Error: Enter a token first.'); return; }
    setBusy('save'); setStatus('Saving…');
    try {
      const me = await makeClient(token()).get('user');
      saveGithubConfig({ ...(pat.trim() ? { pat: pat.trim() } : {}), repos: selected, issues, login: me?.login || '' });
      // Drop the cache so the reload refetches for the new settings.
      try { localStorage.removeItem(GITHUB_CACHE_KEY); } catch (_) {}
      setPat('');
      setStatus('Saved! Reloading data…');
      onSaved?.();
      setTimeout(onClose, 1000);
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'Save failed'));
    } finally { setBusy(''); }
  };

  const toggle = (fullName) => setSelected(s => (s.includes(fullName) ? s.filter(r => r !== fullName) : [...s, fullName]));

  // Before Discover, the list shows what is selected so it can still be unticked.
  const rows = found ? found.repos : selected.map(fullName => ({ fullName, owner: fullName.split('/')[0] }));
  const q = search.trim().toLowerCase();
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (q && !r.fullName.toLowerCase().includes(q)) continue;
      if (!m.has(r.owner)) m.set(r.owner, []);
      m.get(r.owner).push(r);
    }
    return [...m.entries()];
  }, [rows, q]);

  const message = overCap ? `Select at most ${MAX_GITHUB_REPOS} repositories` : status;
  const isError = overCap || status.startsWith('Error');

  return (
    <Sheet open={open} size="tall" icon="pr" title="GitHub" sub="Issues, pull requests and Actions runs" onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost m-btn-lg" onClick={discoverRepos} disabled={!!busy}>
            {busy === 'discover' ? 'Discovering…' : 'Discover repositories'}
          </button>
          <button type="button" className="btn primary m-btn-lg" onClick={save} disabled={!!busy || overCap}>
            {busy === 'save' ? 'Saving…' : 'Save & connect'}
          </button>
        </>
      }>
      <div className="m-fld">
        <label>Personal access token</label>
        <input type="password" value={pat} onChange={e => setPat(e.target.value)}
          placeholder="Leave blank to keep existing token" autoComplete="off"/>
        <div className="m-hint">
          A classic token needs the repo, read:org and workflow scopes; a fine-grained token needs read access to Issues,
          Pull requests, Actions and Metadata.
        </div>
      </div>

      <label className="m-switchrow">
        <input type="checkbox" checked={issues} onChange={e => setIssues(e.target.checked)}/>
        <span>Load GitHub issues</span>
      </label>
      {!issues && <div className="m-hint" style={{ marginTop: -4 }}>Pull requests and Actions runs still come from GitHub.</div>}

      <div className="m-fld" style={{ marginTop: 12 }}>
        <label>Repositories</label>
        <div className="m-search" style={{ marginBottom: 8 }}>
          <span className="si"><Icon name="search" size={16}/></span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search repositories"/>
        </div>
        <div className={`m-hint${overCap ? ' bad' : ''}`}>{selected.length} of {MAX_GITHUB_REPOS} selected</div>
        {groups.length === 0 && (
          <div className="m-hint">{found ? 'No repositories match.' : 'Tap Discover repositories to list what the token can reach.'}</div>
        )}
        {groups.map(([owner, list]) => (
          <div key={owner} role="group" aria-label={owner}>
            <div className="m-sec-h"><span className="lbl">{owner}</span><span className="line"/></div>
            <div className="m-card flush">
              {list.map(r => (
                <label key={r.fullName} className="m-row m-checkrow">
                  <input type="checkbox" checked={selected.includes(r.fullName)} onChange={() => toggle(r.fullName)} aria-label={r.fullName}/>
                  <span className="m-row-main"><span className="m-row-title">{r.fullName}</span></span>
                  {r.private && <span className="pill">private</span>}
                  {r.archived && <span className="pill">archived</span>}
                  {r.hasIssues === false && <span className="pill">issues off</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {found?.ssoOrgs?.length > 0 && (
        <div className="m-fld">
          <label>Orgs needing SSO authorization</label>
          {found.ssoOrgs.map(o => (
            <div key={o.login}><a href={o.url} target="_blank" rel="noopener noreferrer">Authorize the token for {o.login}</a></div>
          ))}
        </div>
      )}

      {message && <div className={isError ? 'm-error' : 'm-ok'} role="status">{message}</div>}
    </Sheet>
  );
}
