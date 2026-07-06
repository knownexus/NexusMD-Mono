import React from 'react';
import { fetchPRCommits, fetchPRFileChanges, fetchFileContent, timeAgo } from '@nexusmd/core';
import { Icon } from '../icons.jsx';

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
