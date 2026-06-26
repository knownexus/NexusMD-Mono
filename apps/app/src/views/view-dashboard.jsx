// view-dashboard.jsx — Mobile dashboard
import { Icon } from '../icons.jsx';
import { effectiveNeedsMe } from '../components.jsx';
import { HelmData, HelmApi } from '../data.jsx';

function DashboardView({
  onOpenItem, onOpenPR, quickLinks, team = [], acknowledgedSet,
  needsMeCriteria, device, hiddenDashWidgets = [],
}) {
  const wi      = HelmData?.WORK_ITEMS || [];
  const prs     = HelmData?.PRS || [];
  const builds  = HelmData?.BUILDS || [];
  const sprint  = HelmData?.SPRINT || {};
  const activity = HelmData?.ACTIVITY || [];

  const openCount    = wi.filter(w => !isTerminalState(w.state)).length;
  const blockedCount = wi.filter(w => /blocked/i.test(w.state)).length;
  const needsMeCount = prs.filter(p => effectiveNeedsMe(p, needsMeCriteria)).length;
  const failedBuilds = builds.filter(b => b.status === 'failed' && !(acknowledgedSet?.has(b.id))).length;

  // Sprint progress
  const sprintItems = wi.filter(w => w.sprint);
  const spDone   = sprintItems.filter(w => isTerminalState(w.state)).length;
  const spActive = sprintItems.filter(w => /active|in.?progress/i.test(w.state)).length;
  const spReview = sprintItems.filter(w => /review/i.test(w.state)).length;
  const spTotal  = sprintItems.length || 1;

  const blockers   = wi.filter(w => /blocked/i.test(w.state)).slice(0, 5);
  const needsMePrs = prs.filter(p => effectiveNeedsMe(p, needsMeCriteria)).slice(0, 4);
  const recentAct  = activity.slice(0, 8);

  const navTo = (view, filter) => window.dispatchEvent(
    new CustomEvent('helm:navigate', { detail: { view, filter } })
  );

  return (
    <>
      <div className="m-appbar">
        <div className="m-ab-lead">
          <div>
            <h1>Home</h1>
            {sprint.name && <div className="m-ab-sub">{sprint.name}</div>}
          </div>
        </div>
        <div className="m-ab-actions">
          <button type="button" className="m-iconbtn" title="Refresh"
            onClick={() => HelmApi?.load().catch(() => {})}>
            <Icon name="refresh" size={18}/>
          </button>
        </div>
      </div>

      <div className="m-screen">
        {/* Stat tiles */}
        <div className="m-stats"
          style={device === 'tablet' ? { gridTemplateColumns: 'repeat(4,1fr)' } : {}}>
          <div className="m-stat" onClick={() => navTo('work')}>
            <div className="v">{openCount}</div>
            <div className="l">Open items</div>
          </div>
          <div className={`m-stat${blockedCount > 0 ? ' alert' : ''}`}
            onClick={() => navTo('work', 'blocked')}>
            <div className="v">{blockedCount}</div>
            <div className="l">Blocked</div>
          </div>
          <div className={`m-stat${needsMeCount > 0 ? ' warn' : ''}`}
            onClick={() => navTo('pr')}>
            <div className="v">{needsMeCount}</div>
            <div className="l">Needs my review</div>
          </div>
          <div className={`m-stat${failedBuilds > 0 ? ' alert' : ''}`}
            onClick={() => navTo('builds')}>
            <div className="v">{failedBuilds}</div>
            <div className="l">Failed builds</div>
          </div>
        </div>

        {/* Sprint progress */}
        {sprintItems.length > 0 && !hiddenDashWidgets.includes('sprint') && (
          <div className="m-card" style={{ marginBottom: 12 }}>
            <div className="m-card-h">
              <span className="ic"><Icon name="sprint" size={15}/></span>
              <h3>Sprint progress</h3>
              <span className="meta">{spDone}/{spTotal}</span>
            </div>
            <div className="m-card-body">
              <div className="m-prog">
                <div className="seg done"  style={{ width: `${(spDone/spTotal)*100}%` }}/>
                <div className="seg prog"  style={{ width: `${(spActive/spTotal)*100}%` }}/>
                <div className="seg review" style={{ width: `${(spReview/spTotal)*100}%` }}/>
              </div>
              <div style={{ display:'flex', gap:12, marginTop:8, fontSize:11.5, color:'var(--text-subtle)' }}>
                <span><span style={{ color:'var(--success)', fontWeight:600 }}>{spDone}</span> done</span>
                <span><span style={{ color:'var(--accent)', fontWeight:600 }}>{spActive}</span> active</span>
                <span><span style={{ color:'var(--violet)', fontWeight:600 }}>{spReview}</span> in review</span>
              </div>
            </div>
          </div>
        )}

        {/* Quick links */}
        {(quickLinks || []).length > 0 && (
          <div className="m-chipscroll" style={{ marginBottom: 12 }}>
            {(quickLinks || []).filter(lnk => lnk.url && lnk.label).map((lnk, i) => (
              <a key={i} className="m-chip" href={lnk.url} target="_blank" rel="noreferrer"
                style={{ color: lnk.color || 'var(--accent)', borderColor: lnk.color || 'var(--accent)' }}>
                <span className="m-chip-ic"><Icon name="link" size={13}/></span>
                {lnk.label}
              </a>
            ))}
          </div>
        )}

        {/* Blockers */}
        {blockers.length > 0 && !hiddenDashWidgets.includes('blockers') && (
          <div className="m-card" style={{ marginBottom: 12 }}>
            <div className="m-card-h">
              <span className="ic"><Icon name="alert" size={15}/></span>
              <h3>Blockers</h3>
              <span className="meta">{blockedCount}</span>
            </div>
            <div className="m-card-body flush">
              {blockers.map(item => (
                <div key={item.id} className="m-row" onClick={() => onOpenItem(item)}>
                  <div className="m-row-main">
                    <div className="m-row-title">{item.title}</div>
                    <div className="m-row-meta">
                      <span className="m-id">#{item.id}</span>
                      {item.assignee && (
                        <span className="m-id">
                          {(team.find(t => t.id === item.assignee)?.name || item.assignee).split(' ')[0]}
                        </span>
                      )}
                    </div>
                  </div>
                  <Icon name="chevron-right" size={16} className="chev"/>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* PRs needing review */}
        {needsMePrs.length > 0 && !hiddenDashWidgets.includes('needsme') && (
          <div className="m-card" style={{ marginBottom: 12 }}>
            <div className="m-card-h">
              <span className="ic"><Icon name="pr" size={15}/></span>
              <h3>Needs my review</h3>
              <span className="meta">{needsMeCount}</span>
            </div>
            <div className="m-card-body flush">
              {needsMePrs.map(pr => (
                <div key={pr.id} className="m-row" onClick={() => onOpenPR(pr)}>
                  <div className="m-row-main">
                    <div className="m-row-title">{pr.title}</div>
                    <div className="m-row-meta">
                      <span className="m-id">{pr.repo}</span>
                      {pr.age && <span className="m-id">{pr.age}</span>}
                    </div>
                  </div>
                  <Icon name="chevron-right" size={16} className="chev"/>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent activity */}
        {recentAct.length > 0 && !hiddenDashWidgets.includes('activity') && (
          <div className="m-card" style={{ marginBottom: 12 }}>
            <div className="m-card-h">
              <span className="ic"><Icon name="clock" size={15}/></span>
              <h3>Recent activity</h3>
            </div>
            <div className="m-card-body flush">
              {recentAct.map((a, i) => (
                <div key={i} className="m-row" style={{ cursor:'default' }}>
                  <div className="m-row-main">
                    <div className="m-row-title" style={{ fontSize:13.5 }}>
                      <span style={{ fontWeight:600 }}>{a.who}</span>
                      {' '}<span style={{ color:'var(--text-muted)' }}>{a.what}</span>
                    </div>
                    <div className="m-row-meta">
                      <span className="m-id">{a.when}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {openCount === 0 && blockers.length === 0 && needsMePrs.length === 0 && (
          <div className="m-empty">
            <div className="ei"><Icon name="dashboard" size={22}/></div>
            <div className="et">All clear</div>
            <div className="es">No open items or blocked work</div>
          </div>
        )}
      </div>
    </>
  );
}

export { DashboardView };
