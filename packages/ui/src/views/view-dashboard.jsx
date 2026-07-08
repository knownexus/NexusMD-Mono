import React from 'react';
// view-dashboard.jsx — Overview / "morning view" for the EM. Shared web + desktop.
// Data + refresh come from useNexusData(); Google integration (Gmail widget) is
// injected via context (web supplies GoogleAuth, desktop passes null → "connect").

import { CardFrame, Prio, Stat } from '../components.jsx';
import { Avatar, TypeIcon } from '../app-components.jsx';
import { Icon } from '../icons.jsx';
import { TriageExportButton, TriageStatusLine } from './triage.jsx';
import { isActiveState, isBlockedState, isReviewState, isTerminalState } from '@nexusmd/core';
import { useNexusData, useEffectiveNeedsMe } from '../data-context.jsx';

const { useState: useStateD, useMemo: useMemoD, useEffect: useEffectD } = React;

const ALL_WIDGET_IDS = ['review', 'blockers', 'team', 'triage', 'activity', 'resolvedme', 'inbox'];
const WIDGET_LABELS = {
  review:     'Needs your review',
  blockers:   'Blockers & risks',
  team:       'Team — working on now',
  triage:     'Triage queue',
  activity:   'Recent activity',
  resolvedme: 'Resolved by me',
  inbox:      'Inbox highlights',
};

function navigateTo(view, filter) {
  window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view, filter: filter || null } }));
}

function QuickNotePopover({ setPlannerData }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  const ref = React.useRef(null);
  const taRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    taRef.current?.focus();
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey   = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const save = () => {
    if (!text.trim()) return;
    const now = new Date();
    const stamp = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
      + ' ' + now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    const separator = `\n\n--- ${stamp} ---\n`;
    setPlannerData(prev => ({ ...prev, notes: (prev.notes || '') + separator + text.trim() }));
    setText('');
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen(v => !v)}>
        <Icon name="plus" size={13}/> Quick note
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 36, right: 0, width: 300,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: 'var(--shadow-pop)', padding: 12,
          display: 'flex', flexDirection: 'column', gap: 8, zIndex: 100,
        }}>
          <textarea
            ref={taRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }}
            placeholder="Jot a note… (⌘↵ to save)"
            rows={4}
            style={{
              resize: 'vertical', width: '100%', boxSizing: 'border-box',
              border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px',
              background: 'var(--surface-2)', color: 'var(--text)', fontSize: 13,
              fontFamily: 'var(--sans)', outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn sm primary" disabled={!text.trim()} onClick={save}>Save to planner</button>
          </div>
        </div>
      )}
    </div>
  );
}

const GREETINGS = {
  morning: [
    'Good morning, Phillip',
    'Rise and shine, Phillip.',
    'Morning, Phillip — coffee first, PRs second.',
    'Ah, you\'re alive. Good morning, Phillip.',
    'The sprint isn\'t going to manage itself, Phillip.',
    'Top of the morning, Phillip.',
  ],
  afternoon: [
    'Good afternoon, Phillip.',
    'Still at it? Good afternoon, Phillip.',
    'Afternoon, Phillip — blockers don\'t unblock themselves.',
    'Back from lunch already, Phillip?',
    'Good afternoon. The board has thoughts.',
  ],
  evening: [
    'Good evening, Phillip.',
    'Burning the midnight oil, Phillip?',
    'Evening, Phillip — the PRs will still be there tomorrow.',
    'Still here, Phillip? Dedication.',
    'Good evening, Phillip. Have you tried turning the sprint off and on again?',
    'It\'s late, Phillip. Go home.',
  ],
};

function pickGreeting() {
  const h = new Date().getHours();
  const pool = h < 12 ? GREETINGS.morning : h < 17 ? GREETINGS.afternoon : GREETINGS.evening;
  return pool[Math.floor(Math.random() * pool.length)];
}

const WIDGET_DESCRIPTIONS = {
  sprint:     'Burndown, per-dev progress, on-track status',
  review:     'PRs waiting on you',
  blockers:   'Blocked items and failed builds',
  team:       'Workload and last activity per developer',
  triage:     'Unassigned and newly created items',
  activity:   'Latest work item changes across the team',
  resolvedme: 'Your closed items and avg resolution time',
};

function AddWidgetPopover({ widgetOrder, onAdd }) {
  const [open, setOpen] = useStateD(false);
  const ref = React.useRef(null);
  const hidden = ALL_WIDGET_IDS.filter(id => !widgetOrder.includes(id));

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey   = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const allShown = hidden.length === 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn sm ghost"
        onClick={() => !allShown && setOpen(v => !v)}
        disabled={allShown}
        title={allShown ? 'All widgets shown' : 'Add a widget'}
      >
        <Icon name="plus" size={13}/> Add widget
      </button>
      {open && !allShown && (
        <div style={{
          position: 'absolute', top: 36, right: 0, width: 280,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: 'var(--shadow-pop)', zIndex: 100,
          overflow: 'hidden',
        }}>
          {hidden.map(id => (
            <div key={id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderBottom: '1px solid var(--border)',
              cursor: 'default',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{WIDGET_LABELS[id]}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{WIDGET_DESCRIPTIONS[id]}</div>
              </div>
              <button className="btn sm ghost" onClick={() => { onAdd(id); if (hidden.length === 1) setOpen(false); }}>
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamWorkloadCard({ team }) {
  const activeCount = team.filter(t => (t.assignedCount || 0) >= 2).length;
  const zeroCount   = team.filter(t => (t.assignedCount || 0) === 0).length;
  const oneCount    = team.filter(t => (t.assignedCount || 0) === 1).length;
  const [open, setOpen] = useStateD(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="stat-clickable is-interactive" style={{ position: 'relative' }}>
      <div className="stat" style={{ cursor: 'pointer' }}
        role="button" tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}
        title="Click to see per-member workload">
        <div className="stat-label">Team workload</div>
        <div className="stat-value">{activeCount} active</div>
        <div className="stat-meta">{zeroCount} unassigned · {oneCount} at low load</div>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: 'var(--shadow-pop)', padding: '4px 0', minWidth: 200,
        }} onClick={e => e.stopPropagation()}>
          {team.map(t => {
            const count = t.assignedCount || 0;
            const color = count === 0 ? 'var(--danger)' : count === 1 ? 'var(--warning)' : 'var(--success)';
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px' }}>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 20, height: 20, borderRadius: 5, padding: '0 4px',
                  background: color + '22', color, fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)',
                }}>{count}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)', minWidth: 36, textAlign: 'right' }}>{t.lastActiveAgo ?? '—'}</span>
              </div>
            );
          })}
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0 0' }}>
            <button className="btn sm ghost" style={{ width: '100%', borderRadius: '0 0 6px 6px', justifyContent: 'center' }}
              onClick={() => { setOpen(false); navigateTo('team'); }}>
              View team →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardView({ onOpenItem, onOpenPR, widgetOrder, setWidgetOrder, quickLinks, density, team: teamProp, acknowledgedSet, needsMeCriteria, setPlannerData, widgetWidths = {}, setWidgetWidths, widgetHeights = {}, setWidgetHeights }) {
  const { data: NexusMDData, api: NexusMDApi } = useNexusData();
  const effectiveNeedsMe = useEffectiveNeedsMe();
  const { PRS, BUILDS, WORK_ITEMS, ACTIVITY, SPRINT, RESOLVED_WI, AVG_RESOLUTION_DAYS } = NexusMDData;
  // Use the filtered team prop (respects hidden/custom members) rather than the raw global
  const TEAM = teamProp || NexusMDData.TEAM;
  const [greeting] = useStateD(() => pickGreeting());

  // ── Headline counts
  const activePRs       = PRS.filter(p => p.status === 'active');
  const needsMyReview   = PRS.filter(p => effectiveNeedsMe(p, needsMeCriteria) && p.status === 'active');
  const failingBuilds   = BUILDS.filter(b => b.status === 'failed' && !(acknowledgedSet && acknowledgedSet.has(b.id)));
  const blockers        = WORK_ITEMS.filter(w => isBlockedState(w.state));
  const unassigned      = WORK_ITEMS.filter(w => !w.assignee && !isTerminalState(w.state));
  const newToday        = WORK_ITEMS.filter(w => w.isNew);
  const triageItems = (() => {
    const seen = new Set();
    return [...newToday, ...unassigned].filter(w => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });
  })();
  const stalePRs = PRS.filter(p => p.status === 'active' && p.age && p.age.endsWith('d') && parseInt(p.age, 10) >= 3);
  const failingPRs = PRS.filter(p => p.status === 'active' && p.ciStatus === 'failed');
  const draftPRs   = PRS.filter(p => p.status === 'draft');

  // Work item headline counts (team-wide)
  const activeWorkItems = WORK_ITEMS.filter(w => isActiveState(w.state));
  const reviewWorkItems = WORK_ITEMS.filter(w => isReviewState(w.state));

  // Blocker urgency
  const criticalBlockers = blockers.filter(b => b.priority === 1).length;
  const highBlockers     = blockers.filter(b => b.priority === 2).length;

  // ── Widget registry
  const widgets = {
    review:     { title: 'Needs your review',     render: () => <NeedsReviewWidget prs={needsMyReview} onOpen={onOpenPR}/>, span: 1 },
    blockers:   { title: 'Blockers & risks',      render: () => <BlockersWidget items={blockers} builds={failingBuilds} onOpen={onOpenItem}/>, span: 1 },
    team:       { title: 'Team — working on now', render: () => <TeamNowWidget team={TEAM} workItems={WORK_ITEMS} onOpen={onOpenItem}/>, span: 2 },
    triage:     { title: 'Triage queue',          render: () => <TriageWidget items={triageItems} onOpen={onOpenItem}/>, span: 1 },
    activity:   { title: 'Recent activity',       render: () => <ActivityWidget items={ACTIVITY} team={TEAM} onOpen={onOpenItem}/>, span: 1 },
    resolvedme: { title: 'Resolved by me',        render: () => <ResolvedByMeWidget items={RESOLVED_WI || []} avgDays={AVG_RESOLUTION_DAYS}/>, span: 1 },
    inbox:      { title: 'Inbox highlights',       render: () => <GmailInboxWidget/>, span: 1 },
  };

  // ── DnD widget reorder
  const [dragId, setDragId] = useStateD(null);
  const [dropId, setDropId] = useStateD(null);
  const onDragStart = (id) => (e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver  = (id) => (e) => { e.preventDefault(); if (id !== dragId) setDropId(id); };
  const onDrop      = (id) => (e) => {
    e.preventDefault();
    if (!dragId || dragId === id) { setDragId(null); setDropId(null); return; }
    const order = widgetOrder.slice();
    const from  = order.indexOf(dragId);
    const to    = order.indexOf(id);
    order.splice(from, 1);
    order.splice(to, 0, dragId);
    setWidgetOrder(order);
    setDragId(null); setDropId(null);
  };

  // ── Hide / restore widgets
  const hideWidget = (id) => {
    setWidgetOrder(widgetOrder.filter(x => x !== id));
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{greeting}</h1>
          <div className="sub">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {SPRINT.daysLeft} days left in {SPRINT.name}</div>
        </div>
        <div className="page-head-actions">
          <TriageStatusLine style={{ marginRight: 4 }} />
          <button className="btn sm ghost" onClick={() => NexusMDApi?.load().catch(() => {})}><Icon name="refresh" size={13}/> Refresh</button>
          <TriageExportButton />
          <QuickNotePopover setPlannerData={setPlannerData}/>
          <AddWidgetPopover widgetOrder={widgetOrder} onAdd={id => setWidgetOrder(widgetOrder.includes(id) ? widgetOrder : [...widgetOrder, id])}/>
          <button className="btn sm primary" onClick={() => window.dispatchEvent(new CustomEvent('nexusmd:create-wi'))}><Icon name="plus" size={13}/> New work item</button>
        </div>
      </div>

      {/* Quick-launch links */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>Quick links</span>
        {(quickLinks || []).filter(lnk => lnk.url && lnk.label).map((lnk, i) => {
          let safeHref = '#';
          try { const u = new URL(lnk.url, location.origin); if (u.protocol === 'http:' || u.protocol === 'https:') safeHref = u.href; } catch (_) {}
          return (
            <a key={i} href={safeHref} target="_blank" rel="noopener noreferrer" className="btn sm ghost"
              style={{ textDecoration: 'none', borderColor: lnk.color, color: lnk.color }}>
              {lnk.label}
            </a>
          );
        })}
      </div>

      {/* Top stats — clickable cards that drill into the relevant view */}
      <div className="stats">
        {/* ── PRs ── */}
        {(() => {
          const PR_SPARKLINE = NexusMDData.PR_SPARKLINE || [];
          const prevCount = (() => {
            try {
              const s = localStorage.getItem('nexusmd_seen_pr');
              if (!s) return null;
              const parsed = JSON.parse(s);
              return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? Object.keys(parsed).length : null;
            } catch { return null; }
          })();
          const prDelta = prevCount != null ? needsMyReview.length - prevCount : null;
          const prTrend = prDelta == null ? null
            : prDelta > 0 ? { dir: 'up',   value: `+${prDelta}` }
            : prDelta < 0 ? { dir: 'down',  value: `${prDelta}` }
            :               { dir: 'flat',  value: '±0' };
          return (
            <ActionableStat
              label="Needs your review"
              value={needsMyReview.length}
              meta={`${activePRs.length} active PRs total`}
              trend={prTrend}
              spark={PR_SPARKLINE} sparkColor="var(--accent)"
              accent={needsMyReview.length ? 'var(--accent)' : null}
              onClick={() => navigateTo('pr', { preset: 'needsMe' })}
              title="Open PRs awaiting your review"
              segments={[
                { label: 'Stale',   value: stalePRs.length,   color: 'var(--warning)', onClick: () => navigateTo('pr', { preset: 'stale' }),   title: 'Active PRs older than 3 days' },
                { label: 'CI fail', value: failingPRs.length, color: 'var(--danger)',  onClick: () => navigateTo('pr', { preset: 'failing' }), title: 'PRs with failing CI' },
                { label: 'Drafts',  value: draftPRs.length,   color: 'var(--text-subtle)', onClick: () => navigateTo('pr', { preset: 'drafts' }), title: 'Draft PRs' },
              ]}
            />
          );
        })()}

        {/* ── Active work items ── */}
        <StatWithHoverList
          label="Active work items"
          value={activeWorkItems.length}
          meta="In progress, team-wide"
          accent={activeWorkItems.length ? 'var(--accent)' : null}
          onClick={() => navigateTo('work', { stateCategory: 'active' })}
          title="Open active work items"
          items={activeWorkItems}
          team={TEAM}
          onOpenItem={onOpenItem}
        />

        {/* ── Needs review ── */}
        <StatWithHoverList
          label="Needs review"
          value={reviewWorkItems.length}
          meta="Awaiting review, team-wide"
          accent={reviewWorkItems.length ? 'var(--violet)' : null}
          onClick={() => navigateTo('work', { stateCategory: 'review' })}
          title="Open work items in review"
          items={reviewWorkItems}
          team={TEAM}
          onOpenItem={onOpenItem}
        />

        {/* ── Blockers ── */}
        <ActionableStat
          label="Open blockers"
          value={blockers.length}
          meta={blockers.length ? blockers[0].title.slice(0, 32) + '…' : 'All clear'}
          trend={null}
          spark={[]} sparkColor="var(--danger)"
          accent={blockers.length ? 'var(--danger)' : null}
          onClick={() => navigateTo('work', { state: 'Blocked' })}
          title="Open all blocked work items"
          segments={[
            { label: 'Critical',    value: criticalBlockers,    color: 'var(--danger)',  onClick: () => navigateTo('work', { state: 'Blocked', priority: 1 }), title: 'Priority-1 blockers' },
            { label: 'High',        value: highBlockers,        color: 'var(--warning)', onClick: () => navigateTo('work', { state: 'Blocked', priority: 2 }), title: 'Priority-2 blockers' },
            { label: 'Build fails', value: failingBuilds.length, color: 'var(--danger)', onClick: () => navigateTo('builds', { status: 'failed' }),            title: 'Failed builds' },
          ]}
        />

        {/* ── Team workload ── */}
        <TeamWorkloadCard team={TEAM} />
      </div>

      {/* Single ordered grid — span:2 widgets get full width, span:1 auto-place */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        {widgetOrder.filter(id => widgets[id]).map(id => {
          const defaultWide = widgets[id].span === 2;
          const isWide = widgetWidths[id] !== undefined ? widgetWidths[id] : defaultWide;
          return (
            <DraggableWidget key={id} id={id} widget={widgets[id]}
              onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
              dropId={dropId} dragId={dragId} onHide={hideWidget}
              isWide={isWide}
              onToggleWidth={() => {
                const currentlyWide = widgetWidths[id] !== undefined ? widgetWidths[id] : defaultWide;
                const next = { ...widgetWidths };
                if (currentlyWide !== defaultWide) {
                  delete next[id];
                } else {
                  next[id] = !currentlyWide;
                }
                setWidgetWidths(next);
              }}
              storedHeight={widgetHeights[id] || null}
              onSetHeight={(wid, h) => {
                const next = h ? { ...widgetHeights, [wid]: h }
                  : Object.fromEntries(Object.entries(widgetHeights).filter(([k]) => k !== wid));
                setWidgetHeights(next);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ActionableStat — clickable Stat card with optional segmented breakdown
// ─────────────────────────────────────────────────────────
function ActionableStat({ onClick, segments, title, ...statProps }) {
  const interactive = typeof onClick === 'function';
  const handleKey = (e) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
  };
  return (
    <div
      className={`stat-clickable${interactive ? ' is-interactive' : ''}`}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? handleKey : undefined}
      title={title}
    >
      <Stat {...statProps}/>
      {segments && segments.length > 0 && (
        <div className="stat-segments">
          {segments.map((s, i) => {
            const segInteractive = typeof s.onClick === 'function';
            return (
              <button
                key={i} type="button" className="stat-seg"
                disabled={!segInteractive}
                onClick={segInteractive ? (e) => { e.stopPropagation(); s.onClick(); } : undefined}
                title={s.title || s.label}
              >
                <span className="stat-seg-dot" style={{ background: s.color }}/>
                <span className="stat-seg-label">{s.label}</span>
                <span className="stat-seg-value mono">{s.value}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// StatWithHoverList — ActionableStat that shows a floating list of the
// underlying work items on hover; clicking a row opens that item.
// ─────────────────────────────────────────────────────────
function StatWithHoverList({ items, team, onOpenItem, ...statProps }) {
  const [hovered, setHovered] = useStateD(false);
  const MAX_ROWS = 8;
  const visible = items.slice(0, MAX_ROWS);
  const extra = items.length - visible.length;
  const nameFor = (id) => (team || []).find(t => t.id === id)?.name || id || 'Unassigned';

  return (
    <div className="stat-hoverlist" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <ActionableStat {...statProps}/>
      {hovered && items.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20,
          background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 6,
          maxHeight: 260, overflowY: 'auto',
        }}>
          {visible.map(w => (
            <div
              key={w.id}
              onClick={onOpenItem ? (e) => { e.stopPropagation(); onOpenItem(w); } : undefined}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              style={{
                display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 8px',
                borderRadius: 6, cursor: onOpenItem ? 'pointer' : 'default', fontSize: 12,
              }}
            >
              <span className="mono muted" style={{ flexShrink: 0 }}>#{w.id}</span>
              <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{w.title}</span>
              <span className="muted" style={{ flexShrink: 0 }}>{w.state}</span>
              <span className="muted" style={{ flexShrink: 0 }}>{nameFor(w.assignee)}</span>
            </div>
          ))}
          {extra > 0 && <div style={{ padding: '5px 8px', fontSize: 11.5, color: 'var(--text-subtle)' }}>+{extra} more</div>}
        </div>
      )}
    </div>
  );
}

function DraggableWidget({ id, widget, onDragStart, onDragOver, onDrop, dragId, dropId, onHide, isWide, onToggleWidth, storedHeight, onSetHeight }) {
  const cardRef = React.useRef(null);
  const liveH = React.useRef(storedHeight || null);

  React.useEffect(() => {
    liveH.current = storedHeight || null;
    if (cardRef.current) {
      cardRef.current.style.height = storedHeight ? storedHeight + 'px' : '';
    }
  }, [storedHeight]);

  const onResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = liveH.current || (cardRef.current?.offsetHeight || 200);
    const onMove = ev => {
      const h = Math.max(80, startH + (ev.clientY - startY));
      liveH.current = h;
      if (cardRef.current) cardRef.current.style.height = h + 'px';
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('blur', cleanup);
      onSetHeight(id, liveH.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('blur', cleanup);
  };

  return (
    <div
      ref={cardRef}
      className={`widget ${dragId === id ? 'dragging' : ''} ${dropId === id ? 'drop-above' : ''}`}
      draggable
      style={{
        ...(isWide ? { gridColumn: '1 / -1' } : {}),
        ...(storedHeight ? { height: storedHeight + 'px', overflow: 'hidden' } : {}),
      }}
      onDragStart={onDragStart(id)}
      onDragOver={onDragOver(id)}
      onDrop={onDrop(id)}
    >
      <div className="widget-grab" title="Drag to reorder">
        <Icon name="grip" size={14}/>
      </div>
      <button type="button" className="widget-toggle-w" title={isWide ? 'Make narrow' : 'Make full width'}
        onClick={e => { e.stopPropagation(); onToggleWidth(); }}>
        {isWide ? '⇒' : '⇔'}
      </button>
      {onHide && (
        <button type="button" className="widget-hide" title="Hide widget"
          onClick={e => { e.stopPropagation(); onHide(id); }}>
          <Icon name="x" size={12}/>
        </button>
      )}
      <CardFrame title={widget.title} padded={false}>
        {widget.render()}
      </CardFrame>
      <div className="widget-resize-h" onMouseDown={onResizeStart} title="Drag to resize height"/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// ShowMoreFooter — reusable "show more / show less" footer
// ─────────────────────────────────────────────────────────
function ShowMoreFooter({ total, shown, onToggle, expanded }) {
  if (total <= shown && !expanded) return null;
  return (
    <div style={{ padding: '7px 14px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
      <button className="btn sm ghost" style={{ width: '100%', fontSize: 11.5 }} onClick={onToggle}>
        {expanded ? <><Icon name="chevron-up" size={11}/> Show less</> : <><Icon name="chevron-down" size={11}/> Show {total - shown} more</>}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Widget: Needs Review
// ─────────────────────────────────────────────────────────
function NeedsReviewWidget({ prs, onOpen }) {
  const [expanded, setExpanded] = useStateD(false);
  const PAGE = 5;
  const visible = expanded ? prs : prs.slice(0, PAGE);
  if (!prs.length) return <div className="empty"><Icon name="check-circle" size={22}/><div style={{marginTop:8}}>Inbox zero. Nice.</div></div>;
  return (
    <div>
      {visible.map(pr => (
        <div key={pr.id} className="pr-row" onClick={() => onOpen(pr)}>
          <div className={`pr-status ${pr.status}`}>
            <Icon name="pr" size={14}/>
          </div>
          <div className="pr-info">
            <div className="pr-title truncate">{pr.title}</div>
            <div className="pr-sub">
              <span>#{pr.id}</span>
              <span>·</span>
              <Avatar who={pr.author} size="xs"/>
              <span style={{ fontWeight: 500 }}>{pr.authorName || pr.author}</span>
              <span>·</span>
              <span>{pr.repo}</span>
              <span>·</span>
              <span>opened {pr.age} ago</span>
            </div>
          </div>
          <div className="pr-meta">
            {pr.hasConflicts && <span className="pill danger" title="Has conflicts"><Icon name="alert" size={10}/></span>}
            {pr.ciStatus === 'failed' && <span className="pill danger" title="CI failed"><Icon name="x" size={10}/> CI</span>}
            {pr.ciStatus === 'running' && <span className="pill info" title="CI running">CI</span>}
          </div>
        </div>
      ))}
      <ShowMoreFooter total={prs.length} shown={PAGE} onToggle={() => setExpanded(e => !e)} expanded={expanded}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Widget: Blockers
// ─────────────────────────────────────────────────────────
function BlockersWidget({ items, builds, onOpen }) {
  const [expanded, setExpanded] = useStateD(false);
  const PAGE = 5;
  const all = [...builds.map(b => ({ _build: true, ...b })), ...items];
  const visible = expanded ? all : all.slice(0, PAGE);
  if (!items.length && !builds.length) {
    return <div className="empty"><Icon name="check-circle" size={22}/><div style={{marginTop:8}}>No blockers right now.</div></div>;
  }
  return (
    <div>
      {visible.map(w => w._build ? (
        <div key={'b'+w.id} className="activity-item"
          style={{ background: 'var(--danger-soft)', cursor: 'pointer' }}
          onClick={() => navigateTo('builds', { status: 'failed' })}
          title="Open failed builds">
          <div className="activity-icon" style={{ background: 'transparent', color: 'var(--danger)' }}><Icon name="alert" size={14}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>{w.pipeline} failed</div>
            <div className="muted" style={{ fontSize: 11.5 }}>{w.failureReason}</div>
          </div>
          <span className="when">{w.when}</span>
        </div>
      ) : (
        <div key={w.id} className="activity-item" style={{ cursor: 'pointer' }} onClick={() => onOpen(w)}>
          <div className="activity-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><Icon name="alert" size={14}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }} className="truncate">{w.title}</div>
            <div className="muted truncate" style={{ fontSize: 11.5 }}>{w.blocker || 'No reason logged'}</div>
          </div>
          <Avatar who={w.assignee} size="xs"/>
        </div>
      ))}
      <ShowMoreFooter total={all.length} shown={PAGE} onToggle={() => setExpanded(e => !e)} expanded={expanded}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Widget: Team — Working on Now
// ─────────────────────────────────────────────────────────
function TeamNowWidget({ team, workItems, onOpen }) {
  const items = team.map(t => {
    const assigned = workItems.filter(w => w.assignee === t.id && !isTerminalState(w.state));
    assigned.sort((a, b) => a.priority - b.priority);
    const count = t.assignedCount ?? assigned.length;
    return { ...t, current: assigned[0], assignedCount: count };
  });
  const [hoveredId, setHoveredId] = useStateD(null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', padding: 0 }}>
      {items.map((d, i) => {
        const loadColor = d.assignedCount === 0 ? 'var(--danger)'
          : d.assignedCount === 1              ? 'var(--warning)'
          : 'var(--success)';
        return (
          <div key={d.id} style={{
            display: 'grid', gridTemplateColumns: '24px 140px 1fr 56px 64px',
            alignItems: 'center', gap: 12,
            padding: '10px 14px',
            borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
            cursor: d.current ? 'pointer' : 'default',
            transition: 'background .08s',
            background: hoveredId === d.id ? 'var(--surface-2)' : 'transparent',
          }}
            onClick={() => d.current && onOpen(d.current)}
            onMouseEnter={() => setHoveredId(d.id)}
            onMouseLeave={() => setHoveredId(null)}>
            <Avatar who={d.id} size="sm"/>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }} className="truncate">{d.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>{d.role} · {d.tz}</div>
            </div>
            {d.current ? (
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <TypeIcon type={d.current.type}/>
                <span className="mono muted" style={{ fontSize: 11 }}>#{d.current.id}</span>
                <span className="truncate" style={{ fontSize: 12.5 }}>{d.current.title}</span>
              </div>
            ) : (
              <span className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>No active work</span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 22, height: 22, borderRadius: 6, padding: '0 5px',
                background: loadColor + '22', color: loadColor,
                fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)',
              }}>{d.assignedCount}</span>
            </div>
            <div className="muted mono" style={{ fontSize: 10.5, textAlign: 'right' }}>
              {d.lastActiveAgo ?? '—'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Widget: Triage queue
// ─────────────────────────────────────────────────────────
function TriageWidget({ items, onOpen }) {
  const [expanded, setExpanded] = useStateD(false);
  const PAGE = 6;
  const visible = expanded ? items : items.slice(0, PAGE);
  if (!items.length) return <div className="empty">Triage inbox empty.</div>;
  return (
    <div>
      {visible.map(w => (
        <div key={w.id} className="activity-item" style={{ cursor: 'pointer' }} onClick={() => onOpen(w)}>
          <TypeIcon type={w.type}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }} className="truncate">{w.title}</div>
            <div className="muted" style={{ fontSize: 11.5, fontFamily: 'var(--mono)' }}>#{w.id} · {w.updated} ago</div>
          </div>
          {w.isNew && <span className="pill accent" style={{ fontSize: 10 }}>NEW</span>}
          <Prio p={w.priority}/>
        </div>
      ))}
      <ShowMoreFooter total={items.length} shown={PAGE} onToggle={() => setExpanded(e => !e)} expanded={expanded}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Widget: Recent activity
// ─────────────────────────────────────────────────────────
function ActivityWidget({ items, team, onOpen }) {
  const { data: NexusMDData } = useNexusData();
  return (
    <div className="activity">
      {items.map((a, i) => {
        const idMatch = a.what.match(/#(\d+)/);
        const wiId = idMatch ? parseInt(idMatch[1], 10) : null;
        const wi = wiId ? (NexusMDData.WORK_ITEMS || []).find(w => Number(w.id) === wiId) : null;
        const interactive = !!(wi && onOpen);
        return (
          <div key={i} className="activity-item"
            style={{ cursor: interactive ? 'pointer' : 'default' }}
            onClick={interactive ? () => onOpen(wi) : undefined}
            onMouseEnter={e => { if (interactive) e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseLeave={e => { if (interactive) e.currentTarget.style.background = 'transparent'; }}>
            <Avatar who={a.who} size="xs"/>
            <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
              <span className="who">{(team || []).find(t => t.id === a.who)?.name.split(' ')[0] || a.who}</span>
              <span className="what"> {a.action} </span>
              <span style={{ fontWeight: 500 }}>{a.what}</span>
            </div>
            <span className="when">{a.when}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Widget: Resolved by me + avg resolution time
// ─────────────────────────────────────────────────────────
function ResolvedByMeWidget({ items, avgDays }) {
  const { data: NexusMDData } = useNexusData();
  const org = NexusMDData.ORG;
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Resolved (90d)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2, marginTop: 2 }}>{items.length}</div>
        </div>
        {avgDays != null && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Avg resolution</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: avgDays <= 5 ? 'var(--success)' : avgDays <= 14 ? 'var(--warning)' : 'var(--danger)', lineHeight: 1.2, marginTop: 2 }}>{avgDays}d</div>
          </div>
        )}
      </div>
      {items.length === 0 && <div className="empty" style={{ padding: 24 }}>No items resolved in the last 90 days.</div>}
      {items.slice(0, 8).map(wi => (
        <div key={wi.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
          <TypeIcon type={(wi.type || 'task').toLowerCase()} size={14}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {org && wi.project
                ? <a href={`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(wi.project)}/_workitems/edit/${wi.id}`} target="_blank" rel="noopener" style={{ color: 'var(--accent)', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: 12, marginRight: 6 }}>#{wi.id}</a>
                : <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)', marginRight: 6 }}>#{wi.id}</span>}
              {wi.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>{wi.state}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Widget: Gmail Inbox Highlights (requires Google OAuth)
// ─────────────────────────────────────────────────────────
function GmailInboxWidget() {
  const { googleAuth: GoogleAuth } = useNexusData();
  const [msgs,    setMsgs]    = useStateD([]);
  const [loading, setLoading] = useStateD(true);
  const [error,   setError]   = useStateD(null);

  useEffectD(() => {
    if (!GoogleAuth?.isConnected()) { setLoading(false); return; }
    const token = GoogleAuth.getAuth()?.accessToken;
    if (!token) { setLoading(false); return; }
    fetch(`/api/google/gmail/digest?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(12_000) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setMsgs(data.slice(0, 5)); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, []);

  if (!GoogleAuth?.isConnected()) {
    return (
      <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
        Connect Google in <button className="btn sm ghost" style={{ display: 'inline' }}
          onClick={() => document.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: 'settings', tab: 'connection' } }))}>
          Settings → Connection
        </button> to see inbox highlights.
      </div>
    );
  }
  if (loading) return <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 12 }}>Loading…</div>;
  if (error)   return <div style={{ padding: '16px 14px', color: 'var(--danger)', fontSize: 12 }}>Could not load inbox: {error}</div>;
  if (!msgs.length) return <div className="empty" style={{ padding: 24 }}>No recent inbox messages.</div>;

  return (
    <div>
      {msgs.map(m => {
        const initial = (m.from || '?')[0].toUpperCase();
        const fromName = m.from.replace(/<[^>]+>/, '').trim() || m.from;
        return (
          <a key={m.id} href={m.threadUrl} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
              borderBottom: '1px solid var(--border)', textDecoration: 'none', color: 'inherit',
              transition: 'background .1s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)',
              color: 'var(--accent-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              {initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.subject || '(no subject)'}</span>
                <span style={{ fontSize: 10.5, color: 'var(--text-subtle)', flexShrink: 0, fontFamily: 'var(--mono)' }}>{m.date?.slice(5, 11) || ''}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: 'var(--text-subtle)', marginRight: 4 }}>{fromName}</span>
                {m.snippet}
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
