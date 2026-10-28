import React from 'react';
import { fetchPRCommits, fetchPRFileChanges, fetchFileContent, fetchPRThreads, postPRThread, postPRReply, setPRThreadStatus, updatePRDescription, timeAgo, makeGithubClient, displayIdOf } from '@nexusmd/core';
import { renderContent, mdToHtml } from './render-content.js';
import { toast } from '../toast.jsx';
import { Icon } from '../icons.jsx';
import { useNexusData } from '../data-context.jsx';
import { GithubPRCommitsTab, GithubPRFilesTab, GithubPRThreadsPanel, GithubPRDescription } from './pr-tabs-github.jsx';

const { useState, useEffect } = React;

// ── diffLines ─────────────────────────────────────────────────────────────────
// Simple LCS-based line diff. Ported from apps/app/src/app.jsx:2312-2336.
function diffLines(oldLines, newLines) {
  const N = oldLines.length, M = newLines.length;
  const MAX = 400;
  if (N > MAX || M > MAX) return null;
  const lcs = new Int32Array((N + 1) * (M + 1));
  for (let i = N - 1; i >= 0; i--) {
    for (let j = M - 1; j >= 0; j--) {
      const idx = i * (M + 1) + j;
      if (oldLines[i] === newLines[j]) lcs[idx] = 1 + lcs[(i + 1) * (M + 1) + (j + 1)];
      else lcs[idx] = Math.max(lcs[(i + 1) * (M + 1) + j], lcs[i * (M + 1) + (j + 1)]);
    }
  }
  const result = [];
  let i = 0, j = 0;
  while (i < N || j < M) {
    if (i < N && j < M && oldLines[i] === newLines[j]) {
      result.push({ t: '=', v: oldLines[i] }); i++; j++;
    } else if (j < M && (i >= N || lcs[(i + 1) * (M + 1) + j] >= lcs[i * (M + 1) + (j + 1)])) {
      result.push({ t: '+', v: newLines[j] }); j++;
    } else {
      result.push({ t: '-', v: oldLines[i] }); i++;
    }
  }
  return result;
}

// ── PRCommitsTab ──────────────────────────────────────────────────────────────
export function PRCommitsTab({ pr, http }) {
  const [state, setState] = useState({ status: 'idle', commits: [], error: null });

  useEffect(() => {
    if (!pr.repoId || !pr.project) { setState({ status: 'error', commits: [], error: 'Missing repo or project info.' }); return; }
    setState({ status: 'loading', commits: [], error: null });
    fetchPRCommits(http, { project: pr.project, repoId: pr.repoId, prId: pr.id })
      .then(commits => setState({ status: 'ok', commits, error: null }))
      .catch(e => setState({ status: 'error', commits: [], error: e.message }));
  }, [pr.id, pr.repoId, pr.project, http]);

  if (state.status === 'loading') return <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading commits…</div>;
  if (state.status === 'error') return <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>{state.error}</div>;
  if (!state.commits.length) return <div className="drawer-section empty">No commits found.</div>;

  return (
    <div className="drawer-section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {state.commits.map(c => {
          const shortId = (c.commitId || '').slice(0, 7);
          const adoUrl = pr.org && pr.project
            ? `https://dev.azure.com/${encodeURIComponent(pr.org)}/${encodeURIComponent(pr.project)}/_git/${pr.repo || pr.repoId}/commit/${c.commitId}`
            : null;
          const authorName = c.author?.name || c.committer?.name || '';
          const authorDate = c.author?.date || c.committer?.date || null;
          const message = (c.comment || '').split('\n')[0];
          return (
            <div key={c.commitId} style={{ padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 6, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, minWidth: 0, lineHeight: 1.4 }}>{message || '(no message)'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {adoUrl
                  ? <a href={adoUrl} target="_blank" rel="noopener" className="mono muted" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>{shortId}</a>
                  : <span className="mono muted" style={{ fontSize: 11 }}>{shortId}</span>}
                {authorName && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{authorName}</span>}
                {authorDate && <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{timeAgo(authorDate)} ago</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PRFilesTab ────────────────────────────────────────────────────────────────
export function PRFilesTab({ pr, http }) {
  const [state, setState] = useState({ status: 'idle', files: [], srcCommit: null, baseCommit: null, error: null });
  const [expanded, setExpanded] = useState({});
  const [fileContents, setFileContents] = useState({});

  useEffect(() => {
    if (!pr.repoId || !pr.project) { setState({ status: 'error', files: [], srcCommit: null, baseCommit: null, error: 'Missing repo or project info.' }); return; }
    setState({ status: 'loading', files: [], srcCommit: null, baseCommit: null, error: null });
    fetchPRFileChanges(http, { project: pr.project, repoId: pr.repoId, prId: pr.id })
      .then(({ files, srcCommit, baseCommit }) => setState({ status: 'ok', files, srcCommit, baseCommit, error: null }))
      .catch(e => setState({ status: 'error', files: [], srcCommit: null, baseCommit: null, error: e.message }));
  }, [pr.id, pr.repoId, pr.project, http]);

  const toggleFile = async (file) => {
    const path = file.item?.path;
    if (!path) return;
    const key = path;
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    if (fileContents[key] || !state.srcCommit) return;
    const changeType = (file.changeType || '').toLowerCase();

    const fetchContent = async (commitId) => {
      try { return await fetchFileContent(http, { project: pr.project, repoId: pr.repoId, path, commitId }); }
      catch (_) { return null; }
    };

    try {
      let oldText = '', newText = '';
      if (changeType === 'add') {
        newText = (await fetchContent(state.srcCommit)) ?? '';
      } else if (changeType === 'delete') {
        oldText = (await fetchContent(state.baseCommit)) ?? '';
      } else {
        [oldText, newText] = await Promise.all([
          fetchContent(state.baseCommit).then(t => t ?? ''),
          fetchContent(state.srcCommit).then(t => t ?? ''),
        ]);
      }
      setFileContents(prev => ({ ...prev, [key]: { oldText, newText, changeType } }));
    } catch (e) {
      setFileContents(prev => ({ ...prev, [key]: { error: e.message } }));
    }
  };

  if (state.status === 'loading') return <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading files…</div>;
  if (state.status === 'error') return <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>{state.error}</div>;
  if (!state.files.length) return <div className="drawer-section empty">No file changes found.</div>;

  const changeIcon = { add: { icon: '+', color: 'var(--success)' }, delete: { icon: '−', color: 'var(--danger)' }, edit: { icon: '~', color: 'var(--info)' }, rename: { icon: 'R', color: 'var(--warning)' } };

  return (
    <div className="drawer-section">
      <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-subtle)' }}>
        {state.files.length} file{state.files.length !== 1 ? 's' : ''} changed
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {state.files.map((file, idx) => {
          const path = file.item?.path || '';
          const ct = (file.changeType || 'edit').toLowerCase();
          const ind = changeIcon[ct] || changeIcon.edit;
          const isOpen = expanded[path];
          const contents = fileContents[path];
          const filename = path.split('/').pop();
          const dir = path.slice(0, path.lastIndexOf('/') + 1);

          return (
            <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--surface-2)', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => toggleFile(file)}>
                <span style={{ fontSize: 11, fontWeight: 700, color: ind.color, minWidth: 12, textAlign: 'center' }}>{ind.icon}</span>
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span className="muted" style={{ fontSize: 11 }}>{dir}</span><span style={{ fontWeight: 600 }}>{filename}</span>
                </span>
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} style={{ color: 'var(--text-subtle)', flexShrink: 0 }}/>
              </div>

              {isOpen && (
                <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', overflow: 'auto', maxHeight: 480 }}>
                  {!contents && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-subtle)' }}>Loading diff…</div>}
                  {contents?.error && <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--danger)' }}>{contents.error}</div>}
                  {contents && !contents.error && (() => {
                    const oldLines = (contents.oldText || '').split('\n');
                    const newLines = (contents.newText || '').split('\n');
                    const diff = diffLines(oldLines, newLines);
                    if (!diff) {
                      return (
                        <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-subtle)' }}>
                          File too large to diff inline.{' '}
                          {pr.org && pr.project
                            ? <a href={`https://dev.azure.com/${encodeURIComponent(pr.org)}/${encodeURIComponent(pr.project)}/_git/${pr.repo || pr.repoId}/pullrequest/${pr.id}?_a=files`} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>View in ADO</a>
                            : null}
                        </div>
                      );
                    }
                    const ctx = 3;
                    const visible = [];
                    let sameRun = [];
                    const flush = () => {
                      if (!sameRun.length) return;
                      const start = visible.length - sameRun.length;
                      if (sameRun.length <= ctx * 2 + 1) { visible.push(...sameRun); sameRun = []; return; }
                      const keep = sameRun.slice(0, ctx).concat([{ t: '…', v: `… ${sameRun.length - ctx * 2} unchanged lines …` }]).concat(sameRun.slice(-ctx));
                      visible.length = start;
                      visible.push(...keep);
                      sameRun = [];
                    };
                    diff.forEach(line => {
                      if (line.t === '=') { sameRun.push(line); }
                      else { flush(); visible.push(line); }
                    });
                    flush();

                    return (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
                        <tbody>
                          {visible.map((line, i) => {
                            if (line.t === '…') return (
                              <tr key={i} style={{ background: 'var(--surface-2)' }}>
                                <td colSpan={2} style={{ padding: '3px 12px', color: 'var(--text-subtle)', fontSize: 11, textAlign: 'center' }}>{line.v}</td>
                              </tr>
                            );
                            const bg = line.t === '+' ? 'rgba(34,197,94,0.12)' : line.t === '-' ? 'rgba(239,68,68,0.12)' : 'transparent';
                            const fg = line.t === '+' ? 'rgba(34,197,94,0.8)' : line.t === '-' ? 'rgba(239,68,68,0.8)' : 'var(--text-subtle)';
                            return (
                              <tr key={i} style={{ background: bg }}>
                                <td style={{ padding: '1px 8px', color: fg, userSelect: 'none', minWidth: 16, textAlign: 'center', borderRight: '1px solid var(--border)', fontSize: 11 }}>
                                  {line.t === '+' ? '+' : line.t === '-' ? '−' : ''}
                                </td>
                                <td style={{ padding: '1px 10px', color: 'var(--text)', whiteSpace: 'pre', overflowWrap: 'normal' }}>{line.v || ' '}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── PRDescriptionField ────────────────────────────────────────────────────────
// Write/Preview/Save editor for a PR description, mirroring HtmlField's shape
// in work-item-detail.jsx but backed by updatePRDescription instead of a
// work-item field PATCH.
function PRDescriptionField({ pr, http, description, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(description || '');
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => { setText(description || ''); }, [description]);

  const save = async () => {
    setSaving(true); setStatus('Saving…');
    try {
      await updatePRDescription(http, { project: pr.project, repoId: pr.repoId, prId: pr.id, description: text });
      onSaved?.(text);
      setStatus('✓ Saved');
      toast?.('Description updated', 'success');
      setTimeout(() => { setEditing(false); setPreview(false); setStatus(''); }, 1200);
    } catch (e) {
      setStatus('✗ ' + (e.message || 'Save failed'));
    } finally { setSaving(false); }
  };

  const statusColor = status.startsWith('✓') ? 'var(--success)' : status.startsWith('✗') ? 'var(--danger)' : 'var(--text-muted)';
  const tabStyle = (active) => ({
    fontSize: 11.5, padding: '2px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)', cursor: 'pointer', lineHeight: '20px',
  });

  return (
    <div className="drawer-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>Description</h4>
        {!editing && (
          <button className="btn sm ghost" style={{ fontSize: 11.5 }}
            onClick={() => { setText(description || ''); setPreview(false); setStatus(''); setEditing(true); }}>
            <Icon name="edit" size={11}/> Edit
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button style={tabStyle(!preview)} onClick={() => setPreview(false)}>Write</button>
            <button style={tabStyle(preview)} onClick={() => setPreview(true)}>Preview</button>
          </div>
          {preview ? (
            <div className="wi-html-content" style={{
              minHeight: 100, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
              background: 'var(--surface-2)', fontSize: 13, lineHeight: 1.6,
              color: text.trim() ? 'var(--text)' : 'var(--text-subtle)', overflowWrap: 'break-word',
            }} dangerouslySetInnerHTML={{ __html: text.trim() ? mdToHtml(text) : '<em>Nothing to preview</em>' }} />
          ) : (
            <textarea value={text} onChange={e => setText(e.target.value)} rows={8}
              style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }} />
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button className="btn sm primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn sm ghost" onClick={() => { setEditing(false); setPreview(false); setStatus(''); }}>Cancel</button>
            {status && <span style={{ fontSize: 12, color: statusColor }}>{status}</span>}
          </div>
        </div>
      ) : (
        <div className="wi-html-content" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', overflowWrap: 'break-word' }}
          dangerouslySetInnerHTML={{ __html: renderContent(description) }} />
      )}
    </div>
  );
}

// ── PRThreadsPanel ────────────────────────────────────────────────────────────
// Comment thread list: add top-level comment, reply, resolve/reopen.
// Ported from PRDetail's thread state/handlers in apps/app/src/app.jsx:2561-2704.
function PRThreadsPanel({ pr, http }) {
  const [threadState, setThreadState] = useState({ status: 'idle', threads: [], error: null });
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyOpen, setReplyOpen] = useState({});
  const [replyText, setReplyText] = useState({});
  const [replyPosting, setReplyPosting] = useState({});
  const [resolving, setResolving] = useState({});

  useEffect(() => {
    if (!pr.repoId || !pr.project) return;
    setThreadState({ status: 'loading', threads: [], error: null });
    fetchPRThreads(http, { project: pr.project, repoId: pr.repoId, prId: pr.id })
      .then(threads => setThreadState(prev => prev.status === 'loading' ? { status: 'ok', threads, error: null } : prev))
      .catch(e => setThreadState(prev => prev.status === 'loading' ? { status: 'error', threads: [], error: e.message } : prev));
  }, [pr.id, pr.repoId, pr.project, http]);

  const postComment = async () => {
    const content = comment.trim();
    if (!content) return;
    setPosting(true);
    // Optimistic update: snapshot, apply immediately, call the API, roll back on failure.
    const prevThreads = threadState.threads;
    const tempId = `temp-${Date.now()}`;
    const optimisticThread = {
      id: tempId, status: 'active',
      comments: [{ id: tempId, commentType: 1, content, author: { displayName: 'You' } }],
    };
    setThreadState(prev => ({ ...prev, status: 'ok', threads: [...prev.threads, optimisticThread] }));
    setComment('');
    try {
      const data = await postPRThread(http, { project: pr.project, repoId: pr.repoId, prId: pr.id, content });
      if (data && data.id != null) {
        setThreadState(prev => ({ ...prev, threads: prev.threads.map(t => t.id === tempId ? data : t) }));
      }
      toast?.('Comment posted', 'success');
    } catch (e) {
      setThreadState(prev => ({ ...prev, threads: prevThreads }));
      setComment(content);
      toast?.('Failed to post comment: ' + e.message, 'error');
    } finally { setPosting(false); }
  };

  const resolveThread = async (threadId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'fixed' : 'active';
    setResolving(r => ({ ...r, [threadId]: true }));
    try {
      await setPRThreadStatus(http, { project: pr.project, repoId: pr.repoId, prId: pr.id, threadId, status: newStatus });
      setThreadState(prev => ({ ...prev, threads: prev.threads.map(t => t.id === threadId ? { ...t, status: newStatus } : t) }));
    } catch (e) {
      toast?.('Failed to update thread: ' + e.message, 'error');
    } finally {
      setResolving(r => ({ ...r, [threadId]: false }));
    }
  };

  const postReply = async (threadId) => {
    const text = (replyText[threadId] || '').trim();
    if (!text) return;
    const thread = threadState.threads.find(t => t.id === threadId);
    const parentCommentId = Math.max(...(thread?.comments || []).filter(c => c.commentType === 1).map(c => c.id), 0);
    setReplyPosting(r => ({ ...r, [threadId]: true }));
    try {
      const data = await postPRReply(http, { project: pr.project, repoId: pr.repoId, prId: pr.id, threadId, parentCommentId, content: text });
      setThreadState(prev => ({ ...prev, threads: prev.threads.map(t => t.id === threadId ? { ...t, comments: [...(t.comments || []), data] } : t) }));
      setReplyText(r => ({ ...r, [threadId]: '' }));
      setReplyOpen(r => ({ ...r, [threadId]: false }));
    } catch (e) {
      toast?.('Failed to post reply: ' + e.message, 'error');
    } finally {
      setReplyPosting(r => ({ ...r, [threadId]: false }));
    }
  };

  const openCount = threadState.threads.filter(t => t.status === 'active').length;

  return (
    <div className="drawer-section">
      <h4>
        Comments
        {threadState.threads.length > 0 && (
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
            ({threadState.threads.length}{openCount > 0 ? ` · ${openCount} open` : ''})
          </span>
        )}
      </h4>
      {threadState.status === 'loading' && (
        <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>Loading comments…</p>
      )}
      {threadState.status === 'error' && (
        <p style={{ fontSize: 12.5, color: 'var(--danger)', margin: 0 }}>{threadState.error}</p>
      )}
      {threadState.status === 'ok' && threadState.threads.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', margin: 0 }}>No comments yet.</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {threadState.threads.map(t => {
          const isOpen = t.status === 'active';
          const filePath = t.threadContext?.filePath;
          const visibleComments = (t.comments || []).filter(c => c.commentType === 1 && !c.isDeleted);
          const isReplying = replyOpen[t.id];
          return (
            <div key={t.id} style={{
              border: '1px solid var(--border)', borderLeft: `3px solid ${isOpen ? 'var(--warning)' : 'var(--border)'}`,
              borderRadius: 8, background: 'var(--surface-2)', overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600, background: isOpen ? 'rgba(234,179,8,0.15)' : 'var(--success-soft)', color: isOpen ? 'var(--warning)' : 'var(--success)' }}>
                  {isOpen ? 'Open' : 'Resolved'}
                </span>
                {filePath
                  ? <span className="mono muted truncate" style={{ fontSize: 10.5, flex: 1 }}>{filePath}</span>
                  : <span className="muted" style={{ fontSize: 10.5, flex: 1 }}>General</span>}
                <button className="btn sm ghost" style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
                  disabled={!!resolving[t.id]} onClick={() => resolveThread(t.id, t.status)}>
                  {resolving[t.id] ? '…' : isOpen ? 'Resolve' : 'Re-open'}
                </button>
              </div>
              <div>
                {visibleComments.map((c, idx) => (
                  <div key={c.id || idx} style={{ padding: '10px 12px', borderBottom: idx < visibleComments.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, flexWrap: 'wrap', gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{c.author?.displayName || 'Unknown'}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{c.publishedDate ? timeAgo(c.publishedDate) + ' ago' : ''}</span>
                    </div>
                    <div className="wi-html-content" style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, overflowWrap: 'break-word' }}
                      dangerouslySetInnerHTML={{ __html: renderContent(c.content || '') }} />
                  </div>
                ))}
              </div>
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                {!isReplying ? (
                  <button className="btn sm ghost" style={{ fontSize: 11.5 }} onClick={() => setReplyOpen(r => ({ ...r, [t.id]: true }))}>Reply</button>
                ) : (
                  <div>
                    <textarea
                      value={replyText[t.id] || ''}
                      onChange={e => setReplyText(r => ({ ...r, [t.id]: e.target.value }))}
                      rows={2}
                      placeholder="Write a reply…"
                      style={{ width: '100%', padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box', marginBottom: 6 }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn sm primary" disabled={replyPosting[t.id]} onClick={() => postReply(t.id)}>
                        {replyPosting[t.id] ? 'Posting…' : 'Post reply'}
                      </button>
                      <button className="btn sm ghost" onClick={() => setReplyOpen(r => ({ ...r, [t.id]: false }))}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={3}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <button className="btn sm primary" onClick={postComment} disabled={posting || !comment.trim()}>
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PRTabs ────────────────────────────────────────────────────────────────────
// Top-level tabbed PR view: Overview (description, reviewers, linked work
// items, comment threads), Commits, Files. Replaces desktop's read-only
// DesktopPRDetail. Ported/composed from apps/app/src/app.jsx's PRDetail
// (2551-2930-ish), backed by the shared pr-collab.js functions.
export function PRTabs({ pr, http }) {
  const [tab, setTab] = useState('overview');
  const [description, setDescription] = useState(pr.description || '');
  // GitHub PRs read through the GitHub adapter from NexusData, never the ADO `http`.
  const isGithub = pr.source === 'github';
  const { githubHttp } = useNexusData();
  const githubClient = React.useMemo(() => (isGithub && githubHttp ? makeGithubClient(githubHttp) : null), [isGithub, githubHttp]);

  const tabBtnStyle = (active) => ({
    fontSize: 12, fontWeight: active ? 600 : 500, padding: '5px 12px', borderRadius: 6,
    border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--accent-fg, #fff)' : 'var(--text-muted)',
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, padding: '0 0 8px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
        {[['overview', 'Overview'], ['commits', 'Commits'], ['files', 'Files']].map(([id, label]) => (
          <button key={id} style={tabBtnStyle(tab === id)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div>
          {isGithub
            ? (description && <GithubPRDescription description={description} />)
            : <PRDescriptionField pr={pr} http={http} description={description} onSaved={setDescription} />}

          {(pr.reviewerDetails || []).length > 0 && (
            <div className="drawer-section">
              <h4>Reviewers</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pr.reviewerDetails.map((r, i) => {
                  const label = r.vote === 10 || r.vote === 5 ? 'Approved' : r.vote === -10 ? 'Rejected' : r.vote === -5 ? 'Waiting for author' : 'Pending';
                  const color = r.vote === 10 || r.vote === 5 ? 'var(--success)' : r.vote === -10 ? 'var(--danger)' : r.vote === -5 ? 'var(--warning)' : 'var(--text-subtle)';
                  return (
                    <div key={`${r.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 13 }}>
                      <span style={{ flex: 1 }}>{r.name || r.id}</span>
                      <span style={{ fontSize: 12, color, fontWeight: 500 }}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(pr.linkedWorkItems || []).length > 0 && (
            <div className="drawer-section">
              <h4>Linked work items</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {pr.linkedWorkItems.map(wi => (
                  <div key={wi.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 12.5 }}>
                    <span className="mono muted" style={{ fontSize: 11 }}>{displayIdOf(wi)}</span>
                    {(wi.title || !isGithub) && <span style={{ flex: 1, minWidth: 0 }} className="truncate">{wi.title || `Work Item #${wi.id}`}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isGithub ? <GithubPRThreadsPanel pr={pr} client={githubClient} /> : <PRThreadsPanel pr={pr} http={http} />}
        </div>
      )}

      {tab === 'commits' && (isGithub ? <GithubPRCommitsTab pr={pr} client={githubClient} /> : <PRCommitsTab pr={pr} http={http} />)}
      {tab === 'files' && (isGithub ? <GithubPRFilesTab pr={pr} client={githubClient} /> : <PRFilesTab pr={pr} http={http} />)}
    </div>
  );
}
