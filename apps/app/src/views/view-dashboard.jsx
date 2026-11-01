// view-dashboard.jsx — Mobile dashboard
import { useState, useEffect } from 'react';
import { Icon } from '../icons.jsx';
import { effectiveNeedsMe } from '../components.jsx';
import { HelmData, HelmApi } from '../data.jsx';
import { appQueue } from '../offline-queue-app.js';
import { PullRefresh } from '../pull-refresh.jsx';
import { syncLabel, offlineText } from '../sync-status.js';
import { PageWidgets } from './dashboard-page-widgets.jsx';
import { PrWidget, LatestBuild, LatestTest } from './dashboard-interactive-widgets.jsx';

// Jira ids are stored as 'jira:TFP-123'; show the key.
const shortId = (id) => String(id).replace(/^jira:/, '');

function DashboardView({
  onOpenItem, onOpenPR, quickLinks, team = [], acknowledgedSet,
  needsMeCriteria, device, hiddenDashWidgets = [], offScreens = [], calendarEvents = [], plannerData = {}, showMarkdown = true,
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
  const meId = HelmData?.ME?.id;
  const myAll = wi.filter(w => meId && w.assignee === meId && !isTerminalState(w.state));
  const myWork = myAll.slice(0, 5), myWorkCount = myAll.length;
  const showBuilds = !offScreens.includes('builds'), showTests = !offScreens.includes('tests');
  const recentBuilds = builds.slice(0, 5);
  const recentTests = (HelmData?.TESTS || []).slice(0, 5);

  // Tiles drill down in place; null shows the default Blockers / Needs-review cards.
  const [drill, setDrill] = useState(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  // Changes kept for later, and a clock so "Updated 2m ago" keeps moving.
  const [pending, setPending] = useState(() => appQueue.count());
  const [, setTick] = useState(0);
  useEffect(() => {
    const onQ = (e) => setPending(e.detail?.count ?? appQueue.count());
    const t = setInterval(() => setTick(n => n + 1), 30000);
    window.addEventListener('helm:queue', onQ);
    return () => { window.removeEventListener('helm:queue', onQ); clearInterval(t); };
  }, []);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  const toggleDrill = (k) => setDrill(d => (d === k ? null : k));
  const drillList = drill === 'open'    ? wi.filter(w => !isTerminalState(w.state)).slice(0, 8)
                  : drill === 'blocked' ? wi.filter(w => /blocked/i.test(w.state)).slice(0, 8)
                  : null;
  const drillPrs  = drill === 'review'  ? prs.filter(p => effectiveNeedsMe(p, needsMeCriteria)).slice(0, 8) : null;
  const initials  = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

  const navTo = (view, filter, repoId) => window.dispatchEvent(
    new CustomEvent('helm:navigate', { detail: { view, filter, repoId } })
  );

  return (
    <>
      <div className="m-appbar">
        <div className="m-ab-lead">
          <div>
            <h1>Home</h1>
            {(sprint.name || HelmData?.loadedAt) && (
              <div className="m-ab-sub">
                {[sprint.name, syncLabel(HelmData?.loadedAt)].filter(Boolean).join(' · ')}
                {online && pending > 0 && <span className="m-pending"> · {pending} waiting to sync</span>}
              </div>
            )}
          </div>
        </div>
        <div className="m-ab-actions">
          {sprint.daysLeft > 0 && <span className="m-daysleft">{sprint.daysLeft} days left</span>}
          <button type="button" className="m-iconbtn" title="Refresh"
            onClick={() => HelmApi?.load().catch(() => {})}>
            <Icon name="refresh" size={18}/>
          </button>
        </div>
      </div>

      {!online && (
        <div className="m-offline">
          <Icon name="alert" size={14}/>
          <span>{offlineText(pending)}</span>
        </div>
      )}

      <PullRefresh onRefresh={() => HelmApi?.load()}>
        {/* Stat tiles */}
        <div className="m-stats"
          style={device === 'tablet' ? { gridTemplateColumns: 'repeat(4,1fr)' } : {}}>
          <div className={`m-stat${drill === 'open' ? ' on' : ''}`} onClick={() => toggleDrill('open')}>
            <div className="v">{openCount}</div>
            <div className="l">Open items</div>
          </div>
          <div className={`m-stat${blockedCount > 0 ? ' alert' : ''}${drill === 'blocked' ? ' on' : ''}`}
            onClick={() => toggleDrill('blocked')}>
            <div className="v">{blockedCount}</div>
            <div className="l">Blocked</div>
          </div>
          <div className={`m-stat${needsMeCount > 0 ? ' warn' : ''}${drill === 'review' ? ' on' : ''}`}
            onClick={() => toggleDrill('review')}>
            <div className="v">{needsMeCount}</div>
            <div className="l">Needs my review</div>
          </div>
          <div className={`m-stat${failedBuilds > 0 ? ' alert' : ''}`}
            onClick={() => navTo('builds')}>
            <div className="v">{failedBuilds}</div>
            <div className="l">Failed builds</div>
          </div>
        </div>

        {/* Tile drill-down */}
        {(drillList || drillPrs) && (
          <div className="m-card" style={{ marginTop: 12, marginBottom: 12 }}>
            <div className="m-card-h">
              <h3>{drill === 'open' ? 'Open items' : drill === 'blocked' ? 'Blocked' : 'Needs my review'}</h3>
              <button type="button" className="m-linkbtn"
                onClick={() => navTo(drill === 'review' ? 'pr' : 'work', drill === 'blocked' ? 'blocked' : undefined)}>
                See all
              </button>
            </div>
            <div className="m-card-body flush">
              {(drillList || drillPrs).length === 0 && <div className="m-row-sub" style={{ padding: 16 }}>Nothing here.</div>}
              {(drillList || []).map(item => (
                <div key={item.id} className="m-row" onClick={() => onOpenItem(item)}>
                  <div className="m-row-main">
                    <div className="m-row-title">{item.title}</div>
                    <div className="m-row-meta"><span className="m-id">#{item.displayId || shortId(item.id)}</span></div>
                  </div>
                  <Icon name="chevron-right" size={16} className="chev"/>
                </div>
              ))}
              {(drillPrs || []).map(pr => (
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
                      <span className="m-id">#{item.displayId || shortId(item.id)}</span>
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

        {/* My work */}
        {myWork.length > 0 && !hiddenDashWidgets.includes('mywork') && (
          <div className="m-card" style={{ marginBottom: 12 }}>
            <div className="m-card-h">
              <span className="ic"><Icon name="work" size={15}/></span>
              <h3>Assigned to me</h3>
              <span className="meta">{myWorkCount}</span>
            </div>
            <div className="m-card-body flush">
              {myWork.map(item => (
                <div key={item.id} className="m-row" onClick={() => onOpenItem(item)}>
                  <div className="m-row-main">
                    <div className="m-row-title">{item.title}</div>
                    <div className="m-row-meta">
                      <span className="m-id">#{item.displayId || shortId(item.id)}</span>
                      {item.state && <span className="m-id">{item.state}</span>}
                    </div>
                  </div>
                  <Icon name="chevron-right" size={16} className="chev"/>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Builds */}
        {showBuilds && recentBuilds.length > 0 && !hiddenDashWidgets.includes('builds') && (
          <div className="m-card" style={{ marginBottom: 12 }}>
            <div className="m-card-h">
              <span className="ic"><Icon name="build" size={15}/></span>
              <h3>Builds</h3>
              <button type="button" className="m-linkbtn" onClick={() => navTo('builds')}>See all</button>
            </div>
            <div className="m-card-body flush">
              <LatestBuild build={recentBuilds[0]} navTo={navTo}/>
              {recentBuilds.slice(1).map(b => (
                <div key={b.id} className="m-row" onClick={() => navTo('builds')}>
                  <div className="m-row-main">
                    <div className="m-row-title">{b.pipeline || 'Pipeline'}</div>
                    <div className="m-row-meta">
                      <span className="m-id" style={{ color: b.status === 'failed' ? 'var(--danger)' : b.status === 'success' ? 'var(--success)' : undefined }}>{b.status}</span>
                      {b.branch && <span className="m-id">{String(b.branch).replace(/^refs\/heads\//, '')}</span>}
                    </div>
                  </div>
                  <Icon name="chevron-right" size={16} className="chev"/>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tests */}
        {showTests && recentTests.length > 0 && !hiddenDashWidgets.includes('tests') && (
          <div className="m-card" style={{ marginBottom: 12 }}>
            <div className="m-card-h">
              <span className="ic"><Icon name="check-circle" size={15}/></span>
              <h3>Test runs</h3>
              <button type="button" className="m-linkbtn" onClick={() => navTo('tests')}>See all</button>
            </div>
            <div className="m-card-body flush">
              <LatestTest run={recentTests[0]} navTo={navTo}/>
              {recentTests.slice(1).map((t, i) => (
                <div key={t.id || i} className="m-row" onClick={() => navTo('tests')}>
                  <div className="m-row-main">
                    <div className="m-row-title">{t.name || t.title || t.pipeline || 'Test run'}</div>
                    <div className="m-row-meta"><span className="m-id">{t.result || t.status || ''}</span></div>
                  </div>
                  <Icon name="chevron-right" size={16} className="chev"/>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hiddenDashWidgets.includes('needsme') && !offScreens.includes('pr') && (
          <PrWidget prs={prs} needsMe={p => effectiveNeedsMe(p, needsMeCriteria)} onOpenPR={onOpenPR} navTo={navTo}/>
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
                  <span className="m-avatar">{initials(a.who)}</span>
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

        <PageWidgets hidden={hiddenDashWidgets} offScreens={offScreens} calendarEvents={calendarEvents} plannerData={plannerData} team={team} navTo={navTo} showMarkdown={showMarkdown}/>

        {/* Empty state */}
        {openCount === 0 && blockers.length === 0 && needsMePrs.length === 0 && (
          <div className="m-empty">
            <div className="ei"><Icon name="dashboard" size={22}/></div>
            <div className="et">All clear</div>
            <div className="es">No open items or blocked work</div>
          </div>
        )}
      </PullRefresh>
    </>
  );
}

export { DashboardView };
