// git-view.jsx — read-only repository browser for Android: a searchable repo list, then a repo
// with Files (folders, README, a file viewer) and Commits (grouped by day, with a commit sheet).
import React, { useState, useEffect, useMemo } from 'react';
import { timeAgo } from '@nexusmd/core';
import { MarkdownPreview } from '@nexusmd/ui';
import { Icon } from './icons.jsx';
import { Sheet } from './components.jsx';
import { adoGet, getAdoConfig } from './ado-client.js';
import { listRepos, listBranches, listCommits, listItems, getFile, groupCommitsByDay } from './git-browser.js';
import { getProfileKey } from './profile-keys.js';

const errText = (e) => e?.message || String(e);
const RECENT_KEY = 'helm.git.recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(getProfileKey(RECENT_KEY)) || '[]'); } catch { return []; } };
const saveRecent = (ids) => { try { localStorage.setItem(getProfileKey(RECENT_KEY), JSON.stringify(ids)); } catch {} };
const isMarkdown = (p) => /\.(md|markdown)$/i.test(p);
const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

function RepoRow({ repo, onOpen }) {
  return (
    <div className="m-row" onClick={() => onOpen(repo)}>
      <div className="m-row-main">
        <div className="m-row-title">{repo.name}</div>
        <div className="m-row-sub">{repo.project}</div>
      </div>
      <Icon name="chevron-right" size={16} className="chev"/>
    </div>
  );
}

function FileViewer({ repo, branch, path, onBack, onFlash }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState('');
  const [wrap, setWrap] = useState(false);
  const [raw, setRaw] = useState(false);
  useEffect(() => {
    setText(null); setError('');
    getFile(adoGet, repo, branch, path).then(setText).catch(e => setError(errText(e)));
  }, [repo, branch, path]);
  const md = isMarkdown(path);
  return (
    <>
      <div className="m-appbar">
        <button type="button" className="m-iconbtn" onClick={onBack} aria-label="Back"><Icon name="chevron-left" size={18}/></button>
        <div className="m-ab-lead"><div><h1 style={{ fontSize: 16 }}>{path.split('/').pop()}</h1><div className="m-ab-sub">{path}</div></div></div>
        <div className="m-ab-actions">
          <button type="button" className="m-iconbtn" title="Copy path" onClick={() => { copy(path); onFlash?.('Path copied'); }}><Icon name="copy" size={17}/></button>
          {!md || raw ? <button type="button" className={`m-iconbtn${wrap ? ' active' : ''}`} title="Wrap lines" onClick={() => setWrap(w => !w)}><Icon name="list" size={17}/></button> : null}
        </div>
      </div>
      <div className="m-screen">
        {md && (
          <div className="m-seg" style={{ marginBottom: 12 }}>
            <button type="button" className={!raw ? 'active' : ''} onClick={() => setRaw(false)}>Rendered</button>
            <button type="button" className={raw ? 'active' : ''} onClick={() => setRaw(true)}>Raw</button>
          </div>
        )}
        {error && <div className="m-error">{error}</div>}
        {text === null && !error && <div className="muted">Loading…</div>}
        {text !== null && (md && !raw
          ? <MarkdownPreview markdown={text}/>
          : <div className={`m-code${wrap ? ' wrap' : ''}`}>
              {text.split('\n').map((line, i) => (
                <div key={i} className="ln"><span className="no">{i + 1}</span><span className="tx">{line || ' '}</span></div>
              ))}
            </div>)}
      </div>
    </>
  );
}

export function GitView({ onFlash }) {
  const [repos, setRepos] = useState(null);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(loadRecent);
  const [repo, setRepo] = useState(null);
  const [branches, setBranches] = useState(null);
  const [branch, setBranch] = useState(null);
  const [tab, setTab] = useState('files');
  const [path, setPath] = useState('/');
  const [items, setItems] = useState(null);
  const [readme, setReadme] = useState(null);
  const [openFile, setOpenFile] = useState(null);
  const [commits, setCommits] = useState(null);
  const [branchSheet, setBranchSheet] = useState(false);
  const [branchQuery, setBranchQuery] = useState('');
  const [commitSheet, setCommitSheet] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listRepos(adoGet, getAdoConfig().projects || []).then(setRepos).catch(e => setError(errText(e)));
  }, []);

  // Folder contents (and the README at the root) follow the repo, branch and path.
  useEffect(() => {
    if (!repo || !branch) return;
    setItems(null); setReadme(null);
    listItems(adoGet, repo, branch, path).then(list => {
      setItems(list);
      const rd = path === '/' && list.find(i => !i.isFolder && /^readme\.md$/i.test(i.name));
      if (rd) getFile(adoGet, repo, branch, rd.path).then(setReadme).catch(() => {});
    }).catch(e => setError(errText(e)));
  }, [repo, branch, path]);

  useEffect(() => {
    if (!repo || !branch || tab !== 'commits') return;
    setCommits(null);
    listCommits(adoGet, repo, branch).then(setCommits).catch(e => setError(errText(e)));
  }, [repo, branch, tab]);

  const pickRepo = (r) => {
    const next = [r.id, ...recent.filter(id => id !== r.id)].slice(0, 3);
    setRecent(next); saveRecent(next);
    setRepo(r); setBranch(null); setBranches(null); setPath('/'); setTab('files'); setError('');
    listBranches(adoGet, r).then(bs => {
      setBranches(bs);
      const first = bs.find(b => b.isDefault) || bs[0];
      if (first) setBranch(first.name);
    }).catch(e => setError(errText(e)));
  };
  const leaveRepo = () => { setRepo(null); setOpenFile(null); setError(''); };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos || []).filter(r => !q || `${r.project}/${r.name}`.toLowerCase().includes(q));
  }, [repos, query]);
  const recentRepos = recent.map(id => (repos || []).find(r => r.id === id)).filter(Boolean);

  if (repo && openFile) {
    return <FileViewer repo={repo} branch={branch} path={openFile} onBack={() => setOpenFile(null)} onFlash={onFlash}/>;
  }

  if (!repo) {
    return (
      <>
        <div className="m-appbar">
          <div className="m-ab-lead"><div><h1>Repos</h1><div className="m-ab-sub">Azure DevOps</div></div></div>
        </div>
        <div className="m-screen">
          <div className="m-search" style={{ marginBottom: 12 }}>
            <span className="si"><Icon name="search" size={16}/></span>
            <input type="search" enterKeyHint="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search repositories…"/>
          </div>
          {error && <div className="m-error">{error}</div>}
          {!repos && !error && <div className="muted">Loading repositories…</div>}
          {recentRepos.length > 0 && !query && (
            <>
              <div className="m-sec-h"><span className="lbl">Recent</span><span className="line"/></div>
              <div className="m-card flush">{recentRepos.map(r => <RepoRow key={r.id} repo={r} onOpen={pickRepo}/>)}</div>
            </>
          )}
          {repos && (
            <>
              <div className="m-sec-h"><span className="lbl">All repositories</span><span className="line"/><span className="cnt">{shown.length}</span></div>
              {shown.length === 0
                ? <div className="muted" style={{ fontSize: 13 }}>No repositories match.</div>
                : <div className="m-card flush">{shown.map(r => <RepoRow key={r.id} repo={r} onOpen={pickRepo}/>)}</div>}
            </>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Read-only on Android. Clone, commit and push from the desktop app.
          </div>
        </div>
      </>
    );
  }

  const crumbs = path.split('/').filter(Boolean);
  const shownBranches = (branches || []).filter(b => b.name.toLowerCase().includes(branchQuery.trim().toLowerCase()));

  return (
    <>
      <div className="m-appbar">
        <button type="button" className="m-iconbtn" onClick={leaveRepo} aria-label="Back to repositories"><Icon name="chevron-left" size={18}/></button>
        <div className="m-ab-lead"><div><h1 style={{ fontSize: 17 }}>{repo.name}</h1><div className="m-ab-sub">{repo.project}</div></div></div>
        <div className="m-ab-actions">
          <button type="button" className="m-chip" disabled={!branches} onClick={() => setBranchSheet(true)}>
            <span className="m-chip-ic"><Icon name="git-branch" size={13}/></span>{branch || '…'}
          </button>
        </div>
      </div>

      <div className="m-screen">
        <div className="m-seg" style={{ marginBottom: 12 }}>
          <button type="button" className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files</button>
          <button type="button" className={tab === 'commits' ? 'active' : ''} onClick={() => setTab('commits')}>Commits</button>
        </div>
        {error && <div className="m-error">{error}</div>}

        {tab === 'files' && (
          <>
            <div className="m-crumbs">
              <button type="button" onClick={() => setPath('/')}>{repo.name}</button>
              {crumbs.map((c, i) => (
                <React.Fragment key={i}>
                  <span>/</span>
                  <button type="button" onClick={() => setPath('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</button>
                </React.Fragment>
              ))}
            </div>
            {!items && !error && <div className="muted">Loading…</div>}
            {items && (
              <div className="m-card flush">
                {path !== '/' && (
                  <div className="m-row" onClick={() => setPath('/' + crumbs.slice(0, -1).join('/'))}>
                    <div className="m-row-main"><div className="m-row-title">..</div></div>
                  </div>
                )}
                {items.length === 0 && <div className="muted" style={{ padding: 16, fontSize: 13 }}>This folder is empty.</div>}
                {items.map(i => (
                  <div key={i.path} className="m-row" onClick={() => (i.isFolder ? setPath(i.path) : setOpenFile(i.path))}>
                    <span className="m-fileic"><Icon name={i.isFolder ? 'folder' : 'doc'} size={16}/></span>
                    <div className="m-row-main"><div className="m-row-title">{i.name}</div></div>
                    {i.isFolder && <Icon name="chevron-right" size={16} className="chev"/>}
                  </div>
                ))}
              </div>
            )}
            {readme && (
              <div className="m-card" style={{ marginTop: 12 }}>
                <div className="m-card-h"><h3>README.md</h3>
                  <button type="button" className="m-linkbtn" onClick={() => setOpenFile('/' + (items.find(i => /^readme\.md$/i.test(i.name))?.name || 'README.md'))}>Open</button>
                </div>
                <div className="m-card-body"><MarkdownPreview markdown={readme}/></div>
              </div>
            )}
          </>
        )}

        {tab === 'commits' && (
          <>
            {!commits && !error && <div className="muted">Loading…</div>}
            {commits && commits.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No commits.</div>}
            {commits && groupCommitsByDay(commits).map(g => (
              <React.Fragment key={g.day}>
                <div className="m-sec-h"><span className="lbl">{g.day}</span><span className="line"/></div>
                <div className="m-card flush">
                  {g.commits.map(c => (
                    <div key={c.id} className="m-row" onClick={() => setCommitSheet(c)}>
                      <div className="m-row-main">
                        <div className="m-row-title">{c.message || '(no message)'}</div>
                        <div className="m-row-meta"><span className="m-id">{c.shortId}</span><span className="m-id">{c.author}</span></div>
                      </div>
                      <Icon name="chevron-right" size={16} className="chev"/>
                    </div>
                  ))}
                </div>
              </React.Fragment>
            ))}
          </>
        )}
      </div>

      <Sheet open={branchSheet} icon="git-branch" title="Switch branch" onClose={() => { setBranchSheet(false); setBranchQuery(''); }}>
        <div className="m-search" style={{ marginBottom: 12 }}>
          <span className="si"><Icon name="search" size={16}/></span>
          <input type="search" value={branchQuery} onChange={e => setBranchQuery(e.target.value)} placeholder="Search branches…"/>
        </div>
        <div className="m-card flush">
          {shownBranches.map(b => (
            <div key={b.name} className="m-row" onClick={() => { setBranch(b.name); setPath('/'); setBranchSheet(false); setBranchQuery(''); }}>
              <div className="m-row-main"><div className="m-row-title">{b.name}</div></div>
              {b.isDefault && <span className="pill">default</span>}
              {b.name === branch && <Icon name="check" size={16}/>}
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!commitSheet} icon="git-branch" title="Commit" sub={commitSheet?.shortId} onClose={() => setCommitSheet(null)}
        footer={commitSheet && (
          <>
            <button type="button" className="btn ghost m-btn-lg" onClick={() => { copy(commitSheet.id); onFlash?.('Commit id copied'); }}>Copy</button>
            {commitSheet.url && <a className="btn primary m-btn-lg" href={commitSheet.url} target="_blank" rel="noreferrer">Open in Azure DevOps</a>}
          </>
        )}>
        {commitSheet && (
          <>
            <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, lineHeight: 1.3 }}>{commitSheet.message || '(no message)'}</h2>
            <div className="m-row-sub">Author: {commitSheet.author}</div>
            <div className="m-row-sub">When: {commitSheet.date ? timeAgo(commitSheet.date) : ''}</div>
          </>
        )}
      </Sheet>
    </>
  );
}
