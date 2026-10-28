// pr-tabs-github.jsx — the PR drawer's Commits, Files and comment threads for GitHub pull
// requests, backed by github/pr-collab.js. GitHub threads have no resolve status here, and
// new comments go to the PR's conversation.
import React from 'react';
import { fetchGithubPRCommits, fetchGithubPRFiles, fetchGithubPRThreads, postGithubPRComment, timeAgo } from '@nexusmd/core';
import { renderContent, mdToHtml } from './render-content.js';
import { toast } from '../toast.jsx';
import { Icon } from '../icons.jsx';

const { useState, useEffect } = React;

const ref = (pr) => ({ repo: pr.repo, number: pr.number });
const muted = (text) => <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{text}</div>;
const failed = (text) => <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>{text}</div>;

// Loads once per PR and client: { status: 'loading'|'ok'|'error', value, error }.
function useLoad(load, pr, client) {
  const [state, setState] = useState({ status: 'loading', value: [], error: null });
  useEffect(() => {
    if (!client) { setState({ status: 'error', value: [], error: 'GitHub is not configured.' }); return; }
    let cancelled = false;
    setState({ status: 'loading', value: [], error: null });
    load(client, ref(pr))
      .then(value => { if (!cancelled) setState({ status: 'ok', value, error: null }); })
      .catch(e => { if (!cancelled) setState({ status: 'error', value: [], error: e.message }); });
    return () => { cancelled = true; };
  }, [pr.repo, pr.number, client]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, setState];
}

export function GithubPRCommitsTab({ pr, client }) {
  const [state] = useLoad(fetchGithubPRCommits, pr, client);
  if (state.status === 'loading') return muted('Loading commits…');
  if (state.status === 'error') return failed(state.error);
  if (!state.value.length) return <div className="drawer-section empty">No commits found.</div>;
  return (
    <div className="drawer-section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {state.value.map(c => (
          <div key={c.id} style={{ padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4, marginBottom: 4 }}>{c.message || '(no message)'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <a href={`https://github.com/${pr.repo}/commit/${c.id}`} target="_blank" rel="noopener" className="mono muted" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>{c.id.slice(0, 7)}</a>
              {c.author && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.author}</span>}
              {c.date && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{timeAgo(c.date)} ago</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const CHANGE_ICON = { add: { icon: '+', color: 'var(--success)' }, delete: { icon: '−', color: 'var(--danger)' }, edit: { icon: '~', color: 'var(--info)' }, rename: { icon: 'R', color: 'var(--warning)' } };

// GitHub sends each file's unified diff (`patch`); large or binary files have none.
function Patch({ patch, url }) {
  if (!patch) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-subtle)' }}>
        No inline diff for this file. <a href={url} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>View on GitHub</a>
      </div>
    );
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
      <tbody>
        {patch.split('\n').map((line, i) => {
          const t = line[0];
          const hunk = line.startsWith('@@');
          const bg = hunk ? 'var(--surface-2)' : t === '+' ? 'rgba(34,197,94,0.12)' : t === '-' ? 'rgba(239,68,68,0.12)' : 'transparent';
          const fg = t === '+' ? 'rgba(34,197,94,0.8)' : t === '-' ? 'rgba(239,68,68,0.8)' : 'var(--text-subtle)';
          return (
            <tr key={i} style={{ background: bg }}>
              <td style={{ padding: '1px 8px', color: fg, userSelect: 'none', minWidth: 16, textAlign: 'center', borderRight: '1px solid var(--border)', fontSize: 11 }}>
                {!hunk && (t === '+' ? '+' : t === '-' ? '−' : '')}
              </td>
              <td style={{ padding: '1px 10px', color: hunk ? 'var(--text-subtle)' : 'var(--text)', whiteSpace: 'pre' }}>{(hunk ? line : line.slice(1)) || ' '}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function GithubPRFilesTab({ pr, client }) {
  const [state] = useLoad(fetchGithubPRFiles, pr, client);
  const [expanded, setExpanded] = useState({});
  if (state.status === 'loading') return muted('Loading files…');
  if (state.status === 'error') return failed(state.error);
  if (!state.value.length) return <div className="drawer-section empty">No file changes found.</div>;
  const files = state.value;
  return (
    <div className="drawer-section">
      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-subtle)' }}>
        {files.length} file{files.length !== 1 ? 's' : ''} changed
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {files.map(f => {
          const ind = CHANGE_ICON[f.changeType] || CHANGE_ICON.edit;
          const filename = f.path.split('/').pop();
          const dir = f.path.slice(0, f.path.lastIndexOf('/') + 1);
          const isOpen = expanded[f.path];
          return (
            <div key={f.path} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--surface-2)', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => setExpanded(e => ({ ...e, [f.path]: !e[f.path] }))}>
                <span style={{ fontSize: 11, fontWeight: 700, color: ind.color, minWidth: 12, textAlign: 'center' }}>{ind.icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className="muted" style={{ fontSize: 11 }}>{dir}</span><span style={{ fontWeight: 600 }}>{filename}</span>
                </span>
                <span style={{ fontSize: 11, color: 'var(--success)' }}>+{f.additions}</span>
                <span style={{ fontSize: 11, color: 'var(--danger)' }}>−{f.deletions}</span>
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} style={{ color: 'var(--text-subtle)', flexShrink: 0 }}/>
              </div>
              {isOpen && (
                <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', overflow: 'auto', maxHeight: 480 }}>
                  <Patch patch={f.patch} url={`https://github.com/${pr.repo}/pull/${pr.number}/files`} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GithubPRThreadsPanel({ pr, client }) {
  const [state, setState] = useLoad(fetchGithubPRThreads, pr, client);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);

  const postComment = async () => {
    const text = comment.trim();
    if (!text || !client) return;
    setPosting(true);
    try {
      const c = await postGithubPRComment(client, ref(pr), text);
      setState(prev => {
        const threads = prev.value.slice();
        const i = threads.findIndex(t => t.id === 'conversation');
        if (i >= 0) threads[i] = { ...threads[i], comments: [...threads[i].comments, c] };
        else threads.unshift({ id: 'conversation', path: null, line: null, comments: [c] });
        return { ...prev, status: 'ok', value: threads };
      });
      setComment('');
    } catch (e) {
      toast?.('Could not post: ' + (e?.message || 'unknown error'), 'error');
    } finally { setPosting(false); }
  };

  const threads = state.value;
  return (
    <div className="drawer-section">
      <h4>Comments</h4>
      {state.status === 'loading' && <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>Loading comments…</p>}
      {state.status === 'error' && <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{state.error}</p>}
      {state.status === 'ok' && threads.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>No comments yet.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {threads.map(t => (
          <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              {t.path
                ? <span className="mono muted truncate" style={{ fontSize: 10.5 }}>{t.path}{t.line ? `:${t.line}` : ''}</span>
                : <span className="muted" style={{ fontSize: 10.5 }}>Conversation</span>}
            </div>
            {t.comments.map((c, idx) => (
              <div key={c.id || idx} style={{ padding: '10px 12px', borderBottom: idx < t.comments.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{c.author || 'Unknown'}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.createdDate ? timeAgo(c.createdDate) + ' ago' : ''}</span>
                </div>
                <div className="wi-html-content" style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, overflowWrap: 'break-word' }}
                  dangerouslySetInnerHTML={{ __html: mdToHtml(c.text) }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        rows={3}
        placeholder="Add a comment… (Markdown supported)"
        aria-label="Add a comment"
        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button className="btn sm primary" onClick={postComment} disabled={posting || !comment.trim()}>
          {posting ? 'Posting…' : 'Post comment'}
        </button>
      </div>
    </div>
  );
}

// Read-only description: GitHub PR bodies are markdown and edited on GitHub.
export function GithubPRDescription({ description }) {
  return (
    <div className="drawer-section">
      <h4>Description</h4>
      <div className="wi-html-content" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', overflowWrap: 'break-word' }}
        dangerouslySetInnerHTML={{ __html: renderContent(description) }} />
    </div>
  );
}
