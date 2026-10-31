// github-issue-sheet.jsx — create a GitHub issue from the phone: pick one of the repositories you
// selected, give it a title and description, and optionally labels, an assignee and a milestone
// (loaded from the repository). Never queued: creating twice on reconnect would make a duplicate.
import React from 'react';
import { makeGithubClient, fetchGithubCreateMeta, createGithubIssue } from '@nexusmd/core';
import { Sheet } from '../components.jsx';
import { createGithubHttpAdapter } from '../github-client.js';

export const MAX_TITLE = 256;
export const OFFLINE_ISSUE = "You're offline. Creating an issue needs a connection.";

// Checks the form and builds what the API wants, or says what is wrong.
export function buildIssueInput({ repo, title, body, labels = [], assignee = '', milestone = '' }) {
  const name = String(title || '').trim();
  if (!repo) return { error: 'Choose a repository.' };
  if (!name) return { error: 'Give the issue a title.' };
  if (name.length > MAX_TITLE) return { error: `Keep the title under ${MAX_TITLE} characters.` };
  return {
    input: {
      repo, title: name, body: String(body || '').trim(),
      labels, assignees: assignee ? [assignee] : [], milestone: milestone ? Number(milestone) : undefined,
    },
  };
}

const defaultClient = () => makeGithubClient(createGithubHttpAdapter());
const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function GithubIssueSheet({ open, onClose, repos, onCreated, makeClient = defaultClient, online = isOnline }) {
  const [repo, setRepo] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [labels, setLabels] = React.useState([]);
  const [assignee, setAssignee] = React.useState('');
  const [milestone, setMilestone] = React.useState('');
  const [meta, setMeta] = React.useState(null);
  const [metaError, setMetaError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setRepo((repos || [])[0] || ''); setTitle(''); setBody(''); setLabels([]); setAssignee(''); setMilestone('');
    setError(''); setBusy(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Labels, assignees and milestones belong to the repository: load them when it changes.
  React.useEffect(() => {
    if (!open || !repo) return;
    let live = true;
    setMeta(null); setMetaError(''); setLabels([]); setAssignee(''); setMilestone('');
    fetchGithubCreateMeta(makeClient(), repo)
      .then(m => { if (live) setMeta(m); })
      .catch(e => { if (live) { setMeta({ labels: [], assignees: [], milestones: [] }); setMetaError(e?.message || 'Could not load labels.'); } });
    return () => { live = false; };
  }, [open, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLabel = (l) => setLabels(ls => (ls.includes(l) ? ls.filter(x => x !== l) : [...ls, l]));

  const submit = async () => {
    const r = buildIssueInput({ repo, title, body, labels, assignee, milestone });
    if (r.error) { setError(r.error); return; }
    if (!online()) { setError(OFFLINE_ISSUE); return; }
    setBusy(true); setError('');
    try {
      const made = await createGithubIssue(makeClient(), r.input);
      onCreated?.({ ...made, repo, title: r.input.title });
      onClose();
    } catch (e) {
      setError(e?.message || 'The issue could not be created.');
    } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} size="tall" icon="plus" title="New GitHub issue" sub={repo} onClose={onClose}
      footer={<button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create issue'}</button>}>
      <div className="m-fld">
        <label htmlFor="gh-repo">Repository</label>
        <select id="gh-repo" className="m-select" value={repo} onChange={e => setRepo(e.target.value)}>
          {(repos || []).map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="m-fld">
        <label htmlFor="gh-title">Title</label>
        <input id="gh-title" autoFocus value={title} placeholder="What needs doing?" onChange={e => { setTitle(e.target.value); setError(''); }}
          aria-invalid={!!error && !title.trim()}/>
      </div>
      <div className="m-fld">
        <label htmlFor="gh-body">Description</label>
        <textarea id="gh-body" className="m-docs-text short" style={{ fontFamily: 'inherit', fontSize: 14 }} value={body} onChange={e => setBody(e.target.value)}
          placeholder="Markdown is supported"/>
      </div>

      {!meta && !metaError && <div className="m-hint">Loading labels…</div>}
      {meta && meta.labels.length > 0 && (
        <div className="m-fld">
          <label>Labels</label>
          <div className="m-docs-chips" style={{ flexWrap: 'wrap', overflow: 'visible' }} role="group" aria-label="Labels">
            {meta.labels.map(l => (
              <button key={l} type="button" aria-pressed={labels.includes(l)} className={`m-chip${labels.includes(l) ? ' active' : ''}`} onClick={() => toggleLabel(l)}>{l}</button>
            ))}
          </div>
        </div>
      )}
      {meta && meta.assignees.length > 0 && (
        <div className="m-fld">
          <label htmlFor="gh-assignee">Assignee</label>
          <select id="gh-assignee" className="m-select" value={assignee} onChange={e => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {meta.assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}
      {meta && meta.milestones.length > 0 && (
        <div className="m-fld">
          <label htmlFor="gh-milestone">Milestone</label>
          <select id="gh-milestone" className="m-select" value={milestone} onChange={e => setMilestone(e.target.value)}>
            <option value="">None</option>
            {meta.milestones.map(m => <option key={m.number} value={m.number}>{m.title}</option>)}
          </select>
        </div>
      )}
      {metaError && <div className="m-hint">{metaError} You can still create the issue.</div>}
      {error && <div className="m-error" role="alert">{error}</div>}
    </Sheet>
  );
}
