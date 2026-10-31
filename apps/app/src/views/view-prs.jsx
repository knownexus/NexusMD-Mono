import React from 'react';
import { Icon } from '../icons.jsx';
import { Sheet, effectiveNeedsMe } from '../components.jsx';
import { getProfileKey } from '../profile-keys.js';
// view-prs.jsx — Mobile pull requests
const { useState, useMemo, useEffect } = React;

// ── Module-level pure helpers ─────────────────────────────────────────────────
const prStatusCls = pr => pr.status === 'merged' ? 'merged' : pr.draft ? 'draft' : pr.status === 'active' ? 'active' : 'draft';

// ── PR row component (module-level to prevent remounts) ───────────────────────
function PRRow({ pr, active, onDetail, needsMe }) {
  const statusCls = prStatusCls(pr);
  return (
    <div className={`m-row compact${active ? ' row-flash' : ''}`}
      onClick={() => onDetail(pr)}>
      <div className={`pr-status ${statusCls}`}>
        <Icon name={pr.status === 'merged' ? 'merge' : 'git-branch'} size={14}/>
      </div>
      <div className="m-row-main">
        <div className="m-row-title">{pr.title}</div>
        <div className="m-row-meta">
          <span className="m-id">{pr.displayId || pr.repo}</span>
          {pr.author && <span className="m-id">{pr.author.split(' ')[0]}</span>}
          {pr.age && <span className="m-id">{pr.age}</span>}
          {needsMe && <span className="pill accent">Review</span>}
          {pr.draft && <span className="pill">Draft</span>}
        </div>
      </div>
    </div>
  );
}

// ADO vote values: 10 approved, 5 approved with suggestions, 0 none, -5 waiting, -10 rejected
const voteLabel = v => v >= 10 ? 'approved' : v > 0 ? 'approved with suggestions' : v <= -10 ? 'rejected' : v < 0 ? 'waiting' : 'no vote';

function loadPRViewState() {
  try {
    const s = localStorage.getItem(getProfileKey('helm.prs.viewState'));
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

function PRView({ prs, onOpen, needsMeCriteria, setNeedsMeCriteria, newItemIds, device, onFlash }) {
  const [seg, setSeg]           = useState(() => loadPRViewState().seg ?? 'all');
  const [groupBy, setGroupBy]   = useState(() => loadPRViewState().groupBy ?? null);
  const [detailPR, setDetailPR] = useState(null);

  const needsMe = pr => effectiveNeedsMe(pr, needsMeCriteria);

  useEffect(() => {
    try {
      localStorage.setItem(
        getProfileKey('helm.prs.viewState'),
        JSON.stringify({ seg, groupBy })
      );
    } catch {}
  }, [seg, groupBy]);

  const list = prs || [];
  const needsMeCount = useMemo(() => list.filter(p => needsMe(p)).length, [list, needsMeCriteria]);

  const filtered = useMemo(() => {
    if (seg === 'needsme') return list.filter(p => needsMe(p));
    if (seg === 'drafts')  return list.filter(p => p.draft);
    return list;
  }, [list, seg, needsMeCriteria]);

  return (
    <>
      <div className="m-appbar">
        <div className="m-ab-lead">
          <h1>Pull Requests</h1>
        </div>
        <div className="m-ab-actions">
          <button type="button"
            className={`m-iconbtn${groupBy === 'project' ? ' active' : ''}`}
            title={groupBy === 'project' ? 'Ungroup' : 'Group by project'}
            onClick={() => setGroupBy(g => g === 'project' ? null : 'project')}>
            <Icon name="layers" size={18}/>
          </button>
          <button type="button" className="m-iconbtn"
            onClick={() => HelmApi?.load().catch(() => {})} title="Refresh">
            <Icon name="refresh" size={18}/>
          </button>
        </div>
      </div>

      <div className="m-screen">
        {/* Segmented control */}
        <div className="m-seg" style={{ marginBottom: 12 }}>
          <button type="button" className={seg === 'all' ? 'active' : ''} onClick={() => setSeg('all')}>
            All{' '}<span style={{ opacity:0.6, fontSize:11 }}>{list.length}</span>
          </button>
          <button type="button" className={seg === 'needsme' ? 'active' : ''} onClick={() => setSeg('needsme')}>
            Needs me{needsMeCount > 0 && <span style={{ opacity:0.6, fontSize:11 }}>{' '}{needsMeCount}</span>}
          </button>
          <button type="button" className={seg === 'drafts' ? 'active' : ''} onClick={() => setSeg('drafts')}>
            Drafts
          </button>
        </div>

        {filtered.length === 0
          ? (
            <div className="m-empty">
              <div className="ei"><Icon name="pr" size={22}/></div>
              <div className="et">No pull requests here.</div>
            </div>
          )
          : groupBy === 'project'
            ? (() => {
                const projects = [...new Set(filtered.map(pr => pr.project || 'Unknown'))].sort();
                return projects.map(proj => (
                  <div key={proj} style={{ marginBottom: 16 }}>
                    <div style={{
                      fontWeight: 700, fontSize: 12, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      padding: '0 2px', marginBottom: 6,
                    }}>
                      {proj}
                    </div>
                    <div className="m-card flush">
                      {filtered.filter(pr => (pr.project || 'Unknown') === proj).map(pr => (
                        <PRRow key={pr.id} pr={pr}
                          active={newItemIds?.has(pr.id)}
                          onDetail={setDetailPR}
                          needsMe={needsMe(pr)}/>
                      ))}
                    </div>
                  </div>
                ));
              })()
            : (
              <div className="m-card flush">
                {filtered.map(pr => (
                  <PRRow key={pr.id} pr={pr}
                    active={newItemIds?.has(pr.id)}
                    onDetail={setDetailPR}
                    needsMe={needsMe(pr)}/>
                ))}
              </div>
            )
        }
      </div>

      {/* PR detail sheet */}
      <Sheet open={!!detailPR} size="tall"
        title={detailPR ? `PR #${detailPR.id}` : ''}
        sub={detailPR?.repo}
        onClose={() => setDetailPR(null)}
        footer={
          <>
            <button type="button" className="btn ghost m-btn-lg"
              onClick={() => { onOpen(detailPR); setDetailPR(null); }}>
              <Icon name="link" size={15}/> Open detail
            </button>
            <button type="button" className="btn primary m-btn-lg"
              onClick={() => setDetailPR(null)}>
              Done
            </button>
          </>
        }>
        {detailPR && (
          <>
            <h2 style={{ margin:'0 0 12px', fontSize:17, fontWeight:600, lineHeight:1.3 }}>
              {detailPR.title}
            </h2>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
              <span className={`pr-status ${prStatusCls(detailPR)}`}
                style={{ width:'auto', height:'auto', padding:'4px 10px', borderRadius:999, fontSize:12, fontWeight:600, display:'inline-flex', alignItems:'center', gap:4 }}>
                <Icon name={detailPR.status === 'merged' ? 'merge' : 'git-branch'} size={12}/>
                {detailPR.status}
              </span>
              {detailPR.draft && <span className="pill">Draft</span>}
              {needsMe(detailPR) && <span className="pill accent">Needs my review</span>}
            </div>
            <div className="kv" style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'6px 12px', marginBottom:16 }}>
              {detailPR.author && <><dt style={{ color:'var(--text-subtle)', fontSize:12 }}>Author</dt><dd style={{ margin:0, fontSize:13 }}>{detailPR.author}</dd></>}
              {detailPR.repo   && <><dt style={{ color:'var(--text-subtle)', fontSize:12 }}>Repo</dt><dd style={{ margin:0, fontSize:13 }}>{detailPR.repo}</dd></>}
              {detailPR.sourceBranch && <><dt style={{ color:'var(--text-subtle)', fontSize:12 }}>Branch</dt><dd style={{ margin:0, fontFamily:'var(--mono)', fontSize:12 }}>{detailPR.sourceBranch}</dd></>}
              {detailPR.age    && <><dt style={{ color:'var(--text-subtle)', fontSize:12 }}>Age</dt><dd style={{ margin:0, fontSize:13 }}>{detailPR.age}</dd></>}
              {(detailPR.reviewerDetails || []).length > 0 && (
                <><dt style={{ color:'var(--text-subtle)', fontSize:12 }}>Reviewers</dt>
                  <dd style={{ margin:0, fontSize:13 }}>{(detailPR.reviewerDetails || []).map(r => r.vote ? r.name + ' (' + voteLabel(r.vote) + ')' : r.name).join(', ')}</dd></>
              )}
            </div>
            {detailPR.description && (
              <div style={{ fontSize:13.5, lineHeight:1.6, color:'var(--text-muted)', borderTop:'1px solid var(--border)', paddingTop:12 }}>
                {detailPR.description.length > 500 ? detailPR.description.slice(0, 500) + '…' : detailPR.description}
              </div>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}

export { PRView };
