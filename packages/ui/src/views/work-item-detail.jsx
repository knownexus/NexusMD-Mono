import React from 'react';
// work-item-detail.jsx — shared work item rich-content panel.
// All ADO HTML is passed through DOMPurify before dangerouslySetInnerHTML.
// Renders Description, Acceptance Criteria, Repro Steps (HTML view + textarea edit)
// and the ADO Discussion thread (read + reply).
// Used by WIDetail in app.jsx and by TriageRow in view-triage.jsx.
// Requires: icons.jsx (Icon), toast.jsx (toast), render-content.js (renderContent).

import { renderContent, sanitizeHtml, mdToHtml, stripStructural } from './render-content.js';
import { Icon } from '../icons.jsx';
import { toast } from '../toast.jsx';
import { timeAgo, slugify, sourceOfId } from '@nexusmd/core';
import { useNexusData } from '../data-context.jsx';
import { getWorkItemSource } from './work-item-source.js';
import { useProjectAreas } from '../project-areas.js';
import { TagInput, AreaTreePicker } from './wi-field-pickers.jsx';

// Prefetch cache: keyed by `${id}:${project||''}`, TTL 30s.
// WorkItemDetail checks this before fetching; prefetchWorkItem populates it on hover.
const _wiPrefetch = new Map();

async function prefetchWorkItem(id, project) {
  if (!id) return;
  const key = `${id}:${project || ''}`;
  const hit = _wiPrefetch.get(key);
  if (hit && Date.now() - hit.ts < 30_000) return;
  try {
    const source = getWorkItemSource();
    const [detail, comments] = await Promise.all([
      source.loadDetail(id, project),
      source.loadComments(id, project).catch(() => []),
    ]);
    _wiPrefetch.set(key, { detail, comments, ts: Date.now() });
  } catch (_) {}
}

// ── HtmlField ─────────────────────────────────────────────────────────────────
// Renders a single HTML field with a view/edit toggle.
// On save, PATCHes /api/workitems/{itemId} using the ADO JSON-patch format.
// `markdown` sources (GitHub) store markdown: the editor starts from the plain text
// and saves it as typed, so GitHub never receives HTML.

function HtmlField({ label, value: initialValue, field, itemId, editElsewhereUrl = null, markdown = false }) {
  const { workItemSource } = useNexusData();
  const editText = () => (markdown ? stripStructural(initialValue) : (initialValue || ''));
  const [editing,  setEditing]  = React.useState(false);
  const [text,     setText]     = React.useState(editText);
  const [preview,  setPreview]  = React.useState(false);
  const [saving,   setSaving]   = React.useState(false);
  const [status,   setStatus]   = React.useState('');

  React.useEffect(() => { setText(editText()); }, [initialValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true); setStatus('Saving…');
    try {
      await workItemSource.saveField(itemId, field, markdown ? text : mdToHtml(text));
      setStatus('✓ Saved');
      toast?.(`${label} updated`, 'success');
      setTimeout(() => { setEditing(false); setPreview(false); setStatus(''); }, 1200);
    } catch(e) {
      setStatus('✗ ' + (e.message || 'Save failed'));
    } finally { setSaving(false); }
  };

  const statusColor = status.startsWith('✓') ? 'var(--success)'
    : status.startsWith('✗') ? 'var(--danger)' : 'var(--text-muted)';

  const tabStyle = (active) => ({
    fontSize: 11.5, padding: '2px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    cursor: 'pointer', lineHeight: '20px',
  });

  return (
    <div className="drawer-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>{label}</h4>
        {!editing && editElsewhereUrl && (
          <a className="btn sm ghost" style={{ fontSize: 11.5 }} href={editElsewhereUrl} target="_blank" rel="noopener noreferrer"
            title="This field contains content NexusMD cannot save back to Jira without losing it">
            <Icon name="link" size={11}/> Edit in Jira
          </a>
        )}
        {!editing && !editElsewhereUrl && (
          <button className="btn sm ghost" style={{ fontSize: 11.5 }}
            onClick={() => { setText(editText()); setPreview(false); setStatus(''); setEditing(true); }}>
            <Icon name="edit" size={11}/> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            <button style={tabStyle(!preview)} onClick={() => setPreview(false)}>Write</button>
            <button style={tabStyle(preview)}  onClick={() => setPreview(true)}>Preview</button>
            <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-subtle)', alignSelf: 'center' }}>
              Markdown supported
            </span>
          </div>

          {preview ? (
            <div
              className="wi-html-content"
              style={{
                minHeight: 120, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface-2)', fontSize: 13, lineHeight: 1.6,
                color: text.trim() ? 'var(--text)' : 'var(--text-subtle)', overflowWrap: 'break-word',
              }}
              dangerouslySetInnerHTML={{
                __html: text.trim() ? mdToHtml(text) : '<em>Nothing to preview</em>',
              }}
            />
          ) : (
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={10}
              style={{
                width: '100%', fontFamily: 'var(--mono)', fontSize: 12,
                padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
                background: 'var(--surface-2)', color: 'var(--text)',
                resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box',
              }}
            />
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button className="btn sm primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn sm ghost" onClick={() => { setEditing(false); setPreview(false); setStatus(''); }}>
              Cancel
            </button>
            {status && <span style={{ fontSize: 12, color: statusColor }}>{status}</span>}
          </div>
        </div>
      ) : (
        <div
          className="wi-html-content"
          style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)', overflowWrap: 'break-word' }}
          dangerouslySetInnerHTML={{ __html: renderContent(initialValue) }}
        />
      )}
    </div>
  );
}

// ── Discussion ────────────────────────────────────────────────────────────────
// Shows the ADO comment thread and a reply box.

function Discussion({ id, project, initialComments, markdown = false }) {
  const { workItemSource } = useNexusData();
  const [comments, setComments] = React.useState(initialComments || []);
  const [reply,    setReply]    = React.useState('');
  const [preview,  setPreview]  = React.useState(false);
  const [posting,  setPosting]  = React.useState(false);
  const [status,   setStatus]   = React.useState('');

  React.useEffect(() => { setComments(initialComments || []); }, [initialComments]);

  const postComment = async () => {
    const trimmed = reply.trim();
    if (!trimmed) return;
    setPosting(true); setStatus('Posting…');
    try {
      const data = await workItemSource.addComment(id, project, markdown ? trimmed : mdToHtml(trimmed));
      setComments(c => [...c, data]);
      setReply('');
      setPreview(false);
      setStatus('✓ Posted');
      toast?.('Comment posted', 'success');
      setTimeout(() => setStatus(''), 2000);
    } catch(e) {
      setStatus('✗ ' + (e.message || 'Failed to post').slice(0, 80));
    } finally { setPosting(false); }
  };

  const handleKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') postComment();
  };

  const statusColor = status.startsWith('✓') ? 'var(--success)'
    : status.startsWith('✗') ? 'var(--danger)' : 'var(--text-muted)';

  const tabStyle = (active) => ({
    fontSize: 11.5, padding: '2px 10px', borderRadius: 6, border: '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    cursor: 'pointer', lineHeight: '20px',
  });

  return (
    <div className="drawer-section">
      <h4>
        Discussion
        {comments.length > 0 && (
          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
            ({comments.length})
          </span>
        )}
      </h4>

      {comments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          {comments.map((c, i) => (
            <div key={c.id || i} style={{
              padding: '10px 12px',
              background: 'var(--surface-2)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{c.author || 'Unknown'}</span>
                <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                  {c.createdDate
                    ? (timeAgo(c.createdDate) + ' ago')
                    : ''}
                </span>
              </div>
              <div
                className="wi-html-content"
                style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, overflowWrap: 'break-word' }}
                dangerouslySetInnerHTML={{ __html: renderContent(c.text) }}
              />
            </div>
          ))}
        </div>
      )}

      {comments.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginBottom: 12, marginTop: 0 }}>
          No comments yet.
        </p>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button style={tabStyle(!preview)} onClick={() => setPreview(false)}>Write</button>
        <button style={tabStyle(preview)}  onClick={() => setPreview(true)}>Preview</button>
        <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-subtle)', alignSelf: 'center' }}>
          Markdown supported · Ctrl+Enter to post
        </span>
      </div>

      {preview ? (
        <div
          className="wi-html-content"
          style={{
            minHeight: 72, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--surface-2)', fontSize: 13, lineHeight: 1.6,
            color: reply.trim() ? 'var(--text)' : 'var(--text-subtle)', overflowWrap: 'break-word',
          }}
          dangerouslySetInnerHTML={{
            __html: reply.trim() ? mdToHtml(reply) : '<em>Nothing to preview</em>',
          }}
        />
      ) : (
        <textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          onKeyDown={handleKey}
          rows={3}
          placeholder="Add a comment… (Markdown supported)"
          style={{
            width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8,
            background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13,
            fontFamily: 'var(--mono)', resize: 'vertical', boxSizing: 'border-box',
          }}
        />
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button className="btn sm primary" onClick={postComment} disabled={posting || !reply.trim()}>
          {posting ? 'Posting…' : 'Post comment'}
        </button>
        {status && <span style={{ fontSize: 12, color: statusColor }}>{status}</span>}
      </div>
    </div>
  );
}

// ── WorkItemDetail ────────────────────────────────────────────────────────────
// Top-level component: fetches detail + comments in parallel, renders both.

export function WorkItemDetail({ id, project }) {
  const { workItemSource } = useNexusData();
  const [detail,   setDetail]   = React.useState(null);
  const [comments, setComments] = React.useState(null);
  const [loading,  setLoading]  = React.useState(true);
  const [error,    setError]    = React.useState(null);

  const load = React.useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const key = `${id}:${project || ''}`;
      const hit = _wiPrefetch.get(key);
      if (hit && Date.now() - hit.ts < 30_000) {
        setDetail(hit.detail);
        setComments(hit.comments);
        setLoading(false);
        return;
      }

      const [detailData, commentsData] = await Promise.all([
        workItemSource.loadDetail(id, project),
        workItemSource.loadComments(id, project).catch(() => []),
      ]);

      _wiPrefetch.set(key, { detail: detailData, comments: commentsData ?? [], ts: Date.now() });
      setDetail(detailData);
      setComments(commentsData ?? []);
    } catch(e) {
      setError(e.message || 'Failed to load');
    } finally { setLoading(false); }
  }, [id, project, workItemSource]);

  React.useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13, padding: '16px 0' }}>
        Loading content…
      </div>
    );
  }

  if (error) {
    return (
      <div className="drawer-section" style={{ color: 'var(--danger)', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  const hasAnyContent = detail?.description || detail?.acceptanceCriteria || detail?.reproSteps;
  // Jira fields holding images can't round-trip through HTML → ADF (the image would be
  // dropped on save), so they are shown read-only with a link to edit them in Jira.
  const isJira = sourceOfId(id) === 'jira';
  const editInJiraUrl = (html) => (isJira && /<img\b/i.test(html || '') ? (workItemSource?.webUrl?.({ id }) || null) : null);
  const isGithub = sourceOfId(id) === 'github';

  return (
    <div>
      {detail?.description && (
        <HtmlField
          label="Description"
          value={detail.description}
          field="System.Description"
          itemId={id}
          editElsewhereUrl={editInJiraUrl(detail.description)}
          markdown={isGithub}
        />
      )}
      {detail?.acceptanceCriteria && (
        <HtmlField
          label="Acceptance Criteria"
          value={detail.acceptanceCriteria}
          field="Microsoft.VSTS.Common.AcceptanceCriteria"
          itemId={id}
          editElsewhereUrl={editInJiraUrl(detail.acceptanceCriteria)}
        />
      )}
      {detail?.reproSteps && (
        <HtmlField
          label="Repro Steps"
          value={detail.reproSteps}
          field="Microsoft.VSTS.TCM.ReproSteps"
          itemId={id}
        />
      )}
      {!hasAnyContent && (
        <div className="drawer-section" style={{ color: 'var(--text-subtle)', fontSize: 13 }}>
          No description, acceptance criteria, or repro steps set.
        </div>
      )}
      <Discussion
        id={id}
        project={project}
        initialComments={comments}
        markdown={isGithub}
      />
    </div>
  );
}

WorkItemDetail.prefetch = prefetchWorkItem;

// ── RawFieldsInspector ────────────────────────────────────────────────────────
// Collapsible panel that fetches and dumps all ADO fields for the item.
// Use this to find custom field reference names (e.g. for a custom "Area" field).

export function RawFieldsInspector({ id }) {
  const { workItemSource } = useNexusData();
  const [open,    setOpen]    = React.useState(false);
  const [fields,  setFields]  = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error,   setError]   = React.useState(null);
  const [filter,  setFilter]  = React.useState('');

  const load = async () => {
    if (fields) return;
    setLoading(true); setError(null);
    try {
      setFields(await workItemSource.loadRawFields(id));
    } catch(e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  const toggle = () => {
    if (!open) load();
    setOpen(v => !v);
  };

  const entries = fields
    ? Object.entries(fields)
        .filter(([k, v]) => !filter || k.toLowerCase().includes(filter.toLowerCase()) || String(v).toLowerCase().includes(filter.toLowerCase()))
        .sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <div className="drawer-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <button
        onClick={toggle}
        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0, color: 'var(--text-subtle)', fontSize: 11.5, fontFamily: 'var(--sans)' }}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={10}/>
        All ADO fields
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <input
            value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filter by field name or value…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '5px 8px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', color: 'var(--text)', outline: 'none', marginBottom: 8 }}
          />
          {loading && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Loading…</div>}
          {error   && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
          {entries.length > 0 && (
            <div style={{ fontSize: 11.5, fontFamily: 'var(--mono)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {entries.map(([k, v]) => (
                <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k}>{k}</span>
                  <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(v)}>{String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── WorkItemFieldsEditor ──────────────────────────────────────────────────────
// State/Assignee/Priority/Area/Tags editor block. Ported from WIDetail's
// details section in apps/app/src/app.jsx:2229-2305, generalised to read
// STATES/TEAM/WORK_ITEMS from useNexusData() instead of the HelmData global,
// and to use the shared TagInput/AreaTreePicker from wi-field-pickers.jsx.

export function WorkItemFieldsEditor({ item, onItemUpdated }) {
  const { data, storage, getProfileKey, workItemSource } = useNexusData();
  const TEAM = data.TEAM || [];
  const isJira = item.source === 'jira';
  // GitHub issues are open or closed, have no priority or area, and are assigned by login.
  const isGithub = item.source === 'github';
  const typeStates = isJira ? data.WI_TYPE_STATES_BY_SOURCE?.jira?.[item.type] : null;
  const STATES = isGithub ? ['Open', 'Closed'] : !isJira ? (data.STATES || []) : (() => {
    const base = typeStates?.length ? typeStates : (data.STATES || []);
    return item.state && !base.includes(item.state) ? [item.state, ...base] : base;
  })();
  const jiraPriorities = isJira ? (data.PRIORITIES_BY_SOURCE?.jira || []) : null;
  // Jira assignee options come from the site's assignable users; ADO from the team.
  const assigneeOptions = isJira
    ? (data.JIRA_PEOPLE || []).map(p => ({ id: TEAM.find(t => t.name === p.displayName)?.id || slugify(p.displayName), name: p.displayName }))
    : isGithub ? TEAM.filter(t => t.source === 'github')
    : TEAM;
  const [areas] = useProjectAreas({ storage, getProfileKey });

  const [local, setLocal] = React.useState(item);
  React.useEffect(() => { setLocal(item); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const knownTags = React.useMemo(() => {
    const s = new Set();
    (data.WORK_ITEMS || []).forEach(wi => {
      (wi.tags || []).forEach(t => { if (t) s.add(t); });
    });
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [data.WORK_ITEMS]);

  const stateCategoryOf = (state) => data.STATE_CATEGORIES_BY_SOURCE?.[item.source || 'ado']?.[state] ?? null;

  const patch = async (field, adoValue, localPatch) => {
    const prev = local;
    setLocal(l => ({ ...l, ...localPatch }));
    try {
      await workItemSource.saveField(item.id, field, adoValue);
      onItemUpdated?.(localPatch);
      toast?.('Saved', 'success');
    } catch (e) {
      setLocal(prev);
      toast?.('✗ ' + (e.message || 'Save failed'), 'error');
    }
  };

  const assignee = assigneeOptions.find(t => t.id === local.assignee);

  const sel = {
    background: 'transparent', border: '1px solid transparent', borderRadius: 5,
    padding: '1px 18px 1px 3px', fontSize: 13, color: 'var(--text)',
    cursor: 'pointer', appearance: 'none', outline: 'none',
    fontFamily: 'var(--sans)', maxWidth: '100%',
  };

  return (
    <div className="drawer-section">
      <h4>Details</h4>
      <dl className="kv">
        <dt>State</dt>
        <dd>
          <select value={local.state || ''} style={sel}
            onChange={e => { const v = e.target.value; patch('System.State', v, { state: v, stateCategory: stateCategoryOf(v) }); }}>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </dd>

        <dt>Assignee</dt>
        <dd>
          <select value={assignee?.name || ''} style={sel}
            onChange={e => {
              const name = e.target.value;
              const member = assigneeOptions.find(t => t.name === name);
              patch('System.AssignedTo', name || '', { assignee: member?.id || null });
            }}>
            <option value="">Unassigned</option>
            {assigneeOptions.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </dd>

        {!isGithub && <>
        <dt>Priority</dt>
        <dd>
          {jiraPriorities ? (
            <select value={String(local.priority || 3)} style={sel}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                const p = jiraPriorities.find(x => x.rank === v);
                patch('Microsoft.VSTS.Common.Priority', v, { priority: v, priorityName: p?.name || null });
              }}>
              {jiraPriorities.map(p => <option key={p.id} value={p.rank}>{p.name}</option>)}
            </select>
          ) : (
            <select value={String(local.priority || 3)} style={sel}
              onChange={e => { const v = parseInt(e.target.value, 10); patch('Microsoft.VSTS.Common.Priority', v, { priority: v }); }}>
              <option value="1">1 – Critical</option>
              <option value="2">2 – High</option>
              <option value="3">3 – Medium</option>
              <option value="4">4 – Low</option>
            </select>
          )}
        </dd>
        </>}

        {!isJira && !isGithub && (
          <>
            <dt>Area</dt>
            <dd>
              <AreaTreePicker compact areas={areas} value={local.area || ''}
                onChange={val => patch('Custom.Area', val, { area: val })}/>
            </dd>
          </>
        )}

        <dt>Tags</dt>
        <dd>
          <TagInput
            value={(local.tags || []).join('; ')}
            knownTags={knownTags}
            onChange={str => {
              const tags = str.split(';').map(t => t.trim()).filter(Boolean);
              patch('System.Tags', str.trim(), { tags });
            }}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, minHeight: 28, padding: '1px 6px' }}
          />
        </dd>
      </dl>
    </div>
  );
}
