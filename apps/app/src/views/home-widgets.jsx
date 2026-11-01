// home-widgets.jsx — the optional widgets on Home. None are there until you add one (Add widget, at the bottom of
// Home). Each is configured when it is made, stays as configured, and can be added more than once: two Repo widgets
// for two repos, a PR list for each filter. The list lives in the `homeWidgets` tweak as { id, type, config }.
import React from 'react';
import { Sheet } from '../components.jsx';
import { Icon } from '../icons.jsx';
import { HelmData } from '../data.jsx';
import { getProfileKey } from '../profile-keys.js';
import { Card, TimeWidget, NotesWidget, LatestBuild, LatestTest } from './dashboard-interactive-widgets.jsx';
import { listRepoChoices } from '../git-view.jsx';

const { useState, useEffect } = React;
const sameDay = (iso, d) => typeof iso === 'string' && iso.slice(0, 10) === d;
const readLists = () => { try { return JSON.parse(localStorage.getItem(getProfileKey('helm.lists')) || '{}').lists || []; } catch { return []; } };
const PAGES = [
  ['dashboard', 'Home'], ['work', 'Work items'], ['pr', 'Pull requests'], ['builds', 'Builds'], ['tests', 'Tests'],
  ['calendar', 'Calendar'], ['planner', 'Planner'], ['lists', 'Lists'], ['time', 'Time'], ['notes', 'Notes'],
  ['triage', 'Triage'], ['team', 'Team'], ['markdown', 'Documents'], ['api', 'API Client'], ['editor', 'Editor'], ['git', 'Repos'],
];
const pageLabel = (id) => (PAGES.find(p => p[0] === id) || [])[1] || id;
const COUNT = { key: 'count', label: 'How many to show', kind: 'number', min: 1, max: 15 };

function Row({ title, sub, onClick }) {
  return (
    <div className="m-row" onClick={onClick}>
      <div className="m-row-main">
        <div className="m-row-title">{title}</div>
        {sub ? <div className="m-row-meta"><span className="m-id">{sub}</span></div> : null}
      </div>
      <Icon name="chevron-right" size={16} className="chev"/>
    </div>
  );
}
const Empty = ({ text }) => <div className="m-row-sub" style={{ padding: 16 }}>{text}</div>;

// ── The types ─────────────────────────────────────────────────────────────────────────────────────────────────
// `page` is the screen the widget belongs to (it is not offered when that screen is switched off). `half` widgets
// share a row with another half widget by default; every widget has a Width setting.
export const WIDGET_TYPES = {
  pr: {
    label: 'Pull requests', desc: 'A list of pull requests', page: 'pr', icon: 'pr',
    defaults: { filter: 'needsme', count: 5 },
    fields: [{ key: 'filter', label: 'Show', kind: 'select', options: [['needsme', 'Needs my review'], ['all', 'All'], ['drafts', 'Drafts']] }, COUNT],
    title: (c) => ({ needsme: 'Needs my review', all: 'Pull requests', drafts: 'Draft PRs' }[c.filter] || 'Pull requests'),
    render: (c, x) => {
      const prs = HelmData?.PRS || [];
      const list = c.filter === 'needsme' ? prs.filter(x.needsMe) : c.filter === 'drafts' ? prs.filter(p => p.draft) : prs;
      return (
        <Card icon="pr" title={WIDGET_TYPES.pr.title(c)} meta={list.length} onMore={() => x.navTo('pr')}>
          {list.length === 0 ? <Empty text="Nothing here."/> : list.slice(0, c.count).map(pr => (
            <Row key={pr.id} title={pr.title} sub={[pr.repo, pr.age].filter(Boolean).join(' · ')} onClick={() => x.onOpenPR(pr)}/>
          ))}
        </Card>
      );
    },
  },
  builds: {
    label: 'Builds', desc: 'The latest builds, with the newest up front', page: 'builds', icon: 'build',
    defaults: { count: 3 }, fields: [COUNT],
    render: (c, x) => {
      const list = (HelmData?.BUILDS || []).slice(0, c.count);
      return (
        <Card icon="build" title="Builds" onMore={() => x.navTo('builds')}>
          {list.length === 0 ? <Empty text="No builds."/> : <LatestBuild build={list[0]} navTo={x.navTo}/>}
          {list.slice(1).map(b => (
            <Row key={b.id} title={b.pipeline || 'Pipeline'}
              sub={[b.status, b.branch && String(b.branch).replace(/^refs\/heads\//, '')].filter(Boolean).join(' · ')} onClick={() => x.navTo('builds')}/>
          ))}
        </Card>
      );
    },
  },
  tests: {
    label: 'Test runs', desc: 'The latest test runs, with the newest up front', page: 'tests', icon: 'check-circle',
    defaults: { count: 3 }, fields: [COUNT],
    render: (c, x) => {
      const list = (HelmData?.TESTS || []).slice(0, c.count);
      return (
        <Card icon="check-circle" title="Test runs" onMore={() => x.navTo('tests')}>
          {list.length === 0 ? <Empty text="No test runs."/> : <LatestTest run={list[0]} navTo={x.navTo}/>}
          {list.slice(1).map((t, i) => (
            <Row key={t.id || i} title={t.name || t.title || t.pipeline || 'Test run'} sub={t.result || t.status || ''} onClick={() => x.navTo('tests')}/>
          ))}
        </Card>
      );
    },
  },
  repo: {
    label: 'Repo', desc: 'Jump straight into one repository', page: 'git', icon: 'git-branch', half: true,
    defaults: { repoId: '', repoName: '' }, needsRepo: true,
    fields: [],
    title: (c) => c.repoName || 'Repo',
    render: (c, x) => (
      <Card icon="git-branch" title={c.repoName || 'Repo'}>
        <div style={{ padding: 12 }}>
          <button type="button" className="btn sm primary" style={{ width: '100%' }} onClick={() => x.navTo('git', undefined, c.repoId)}>Open repo</button>
        </div>
      </Card>
    ),
  },
  mywork: {
    label: 'Assigned to me', desc: 'Your open work items', page: 'work', icon: 'work',
    defaults: { count: 5 }, fields: [COUNT],
    render: (c, x) => {
      const me = HelmData?.ME?.id;
      const all = (HelmData?.WORK_ITEMS || []).filter(w => me && w.assignee === me && !x.isTerminalState(w.state));
      return (
        <Card icon="work" title="Assigned to me" meta={all.length} onMore={() => x.navTo('work')}>
          {all.length === 0 ? <Empty text="Nothing assigned."/> : all.slice(0, c.count).map(w => (
            <Row key={w.id} title={w.title} sub={[`#${w.displayId || String(w.id).replace(/^jira:/, '')}`, w.state].filter(Boolean).join(' · ')} onClick={() => x.onOpenItem(w)}/>
          ))}
        </Card>
      );
    },
  },
  calendar: {
    label: 'Today', desc: 'Today’s calendar events', page: 'calendar', icon: 'planner',
    defaults: { count: 5 }, fields: [COUNT],
    render: (c, x) => {
      const today = new Date().toISOString().slice(0, 10);
      const ev = (x.calendarEvents || []).filter(e => sameDay(e.start, today)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
      return (
        <Card icon="planner" title="Today" meta={ev.length} onMore={() => x.navTo('calendar')}>
          {ev.length === 0 ? <Empty text="Nothing on today."/> : ev.slice(0, c.count).map((e, i) => (
            <Row key={e.id || i} title={e.title || 'Event'} sub={e.start.length > 10 ? new Date(e.start).toTimeString().slice(0, 5) : 'All day'} onClick={() => x.navTo('calendar')}/>
          ))}
        </Card>
      );
    },
  },
  planner: {
    label: 'Planner tasks', desc: 'Your open planner tasks', page: 'planner', icon: 'planner',
    defaults: { count: 5 }, fields: [COUNT],
    render: (c, x) => {
      const open = ((x.plannerData || {}).tasks || []).filter(t => t.status !== 'Done' && (t.task || '').trim());
      return (
        <Card icon="planner" title="Planner tasks" meta={open.length} onMore={() => x.navTo('planner')}>
          {open.length === 0 ? <Empty text="No open tasks."/> : open.slice(0, c.count).map((t, i) => (
            <Row key={t.id || i} title={t.task} sub={[t.status, t.due].filter(Boolean).join(' · ')} onClick={() => x.navTo('planner')}/>
          ))}
        </Card>
      );
    },
  },
  lists: {
    label: 'Lists', desc: 'Your lists and their item counts', page: 'lists', icon: 'work',
    defaults: { count: 5 }, fields: [COUNT],
    render: (c, x) => {
      const lists = readLists();
      return (
        <Card icon="work" title="Lists" meta={lists.length} onMore={() => x.navTo('lists')}>
          {lists.length === 0 ? <Empty text="No lists yet."/> : lists.slice(0, c.count).map(l => (
            <Row key={l.id} title={l.name || l.title || 'List'} sub={`${(l.items || []).length} items`} onClick={() => x.navTo('lists')}/>
          ))}
        </Card>
      );
    },
  },
  team: {
    label: 'Team', desc: 'Who is around', page: 'team', icon: 'team',
    defaults: { count: 5 }, fields: [COUNT],
    render: (c, x) => {
      const members = (x.team?.length ? x.team : HelmData?.TEAM || []).slice(0, c.count);
      return (
        <Card icon="team" title="Team" meta={members.length} onMore={() => x.navTo('team')}>
          {members.length === 0 ? <Empty text="No team members."/> : members.map(m => (
            <Row key={m.id} title={m.name} sub={[m.role, m.status].filter(Boolean).join(' · ')} onClick={() => x.navTo('team')}/>
          ))}
        </Card>
      );
    },
  },
  time: {
    label: 'Time', desc: 'Start, pause, mark and stop timers', page: 'time', icon: 'clock',
    defaults: {}, fields: [],
    render: (c, x) => <TimeWidget storageKey={getProfileKey('nexusmd.timelog.v1')} navTo={x.navTo}/>,
  },
  notes: {
    label: 'Quick note', desc: 'Jot a note down', page: 'notes', icon: 'pin',
    defaults: {}, fields: [],
    render: (c, x) => <NotesWidget navTo={x.navTo}/>,
  },
  shortcut: {
    label: 'Shortcut', desc: 'A button that opens one page', icon: 'link', half: true,
    defaults: { to: 'triage' },
    fields: [{ key: 'to', label: 'Opens', kind: 'select', options: PAGES.filter(p => p[0] !== 'dashboard' && p[0] !== 'settings') }],
    title: (c) => pageLabel(c.to),
    render: (c, x) => (
      <div className="m-card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => x.navTo(c.to)}>
        <div className="m-card-h" style={{ borderBottom: 0 }}>
          <h3>{pageLabel(c.to)}</h3>
          <Icon name="chevron-right" size={16} className="chev"/>
        </div>
      </div>
    ),
  },
};

const WIDTHS = [['half', 'Half width'], ['full', 'Full width']];
const widthOf = (w) => w.config?.width || (WIDGET_TYPES[w.type]?.half ? 'half' : 'full');

// ── Host: the widgets, in a grid so half-width ones sit side by side ─────────────────────────────────────────
export function WidgetHost({ widgets = [], offScreens = [], ctx, onEdit }) {
  const shown = widgets.filter(w => WIDGET_TYPES[w.type] && !offScreens.includes(WIDGET_TYPES[w.type].page));
  if (!shown.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 12 }}>
      {shown.map(w => {
        const t = WIDGET_TYPES[w.type];
        return (
          <div key={w.id} style={{ gridColumn: widthOf(w) === 'half' ? 'span 1' : 'span 2', minWidth: 0, position: 'relative' }}>
            {t.render({ ...t.defaults, ...(w.config || {}) }, ctx)}
            <button type="button" className="m-iconbtn" aria-label={`Edit ${t.title ? t.title({ ...t.defaults, ...(w.config || {}) }) : t.label} widget`}
              style={{ position: 'absolute', top: 2, right: 2, width: 30, height: 30, opacity: 0.7 }} onClick={() => onEdit(w)}>
              <Icon name="more" size={15}/>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Add / edit ─────────────────────────────────────────────────────────────────────────────────────────────────
const inputStyle = { width: '100%', height: 40, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' };

function RepoPicker({ value, onPick }) {
  const [repos, setRepos] = useState(null);
  useEffect(() => {
    let live = true;
    listRepoChoices().then(r => live && setRepos(r.repos || [])).catch(() => live && setRepos([]));
    return () => { live = false; };
  }, []);
  return (
    <select style={inputStyle} value={value} aria-label="Repository"
      onChange={e => { const r = (repos || []).find(x => x.id === e.target.value); onPick(r ? { repoId: r.id, repoName: r.name } : { repoId: '', repoName: '' }); }}>
      <option value="">{repos === null ? 'Loading repos…' : 'Choose a repo'}</option>
      {(repos || []).map(r => <option key={r.id} value={r.id}>{r.project ? `${r.project} / ${r.name}` : r.name}</option>)}
    </select>
  );
}

// One sheet for both: pick a type (new), set it up, Add / Save. Editing also offers Remove.
export function WidgetSheet({ open, widget, offScreens = [], onClose, onSave, onRemove }) {
  const editing = !!widget;
  const [type, setType] = useState(null);
  const [config, setConfig] = useState({});
  useEffect(() => {
    if (!open) return;
    if (widget) { setType(widget.type); setConfig({ ...WIDGET_TYPES[widget.type].defaults, ...(widget.config || {}) }); }
    else { setType(null); setConfig({}); }
  }, [open, widget]);
  const t = type && WIDGET_TYPES[type];
  const choose = (k) => { setType(k); setConfig({ ...WIDGET_TYPES[k].defaults }); };
  const set = (patch) => setConfig(c => ({ ...c, ...patch }));
  const ready = t && (!t.needsRepo || config.repoId);
  return (
    <Sheet open={open} icon="plus" title={editing ? 'Widget settings' : t ? `New ${t.label.toLowerCase()} widget` : 'Add a widget'} sub={editing ? t?.label : undefined} onClose={onClose}>
      {!t && (
        <div>
          {Object.entries(WIDGET_TYPES).filter(([, d]) => !d.page || !offScreens.includes(d.page)).map(([k, d]) => (
            <div key={k} className="m-row" onClick={() => choose(k)}>
              <span className="m-fileic"><Icon name={d.icon} size={16}/></span>
              <div className="m-row-main"><div className="m-row-title">{d.label}</div><div className="m-row-sub">{d.desc}</div></div>
              <Icon name="chevron-right" size={16} className="chev"/>
            </div>
          ))}
        </div>
      )}
      {t && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px 8px' }}>
          {t.needsRepo && (
            <label className="m-fld"><span>Repository{editing ? ' (fixed once made)' : ''}</span>
              {editing ? <div className="m-row-title">{config.repoName}</div> : <RepoPicker value={config.repoId} onPick={set}/>}
            </label>
          )}
          {t.fields.map(f => (
            <label key={f.key} className="m-fld"><span>{f.label}</span>
              {f.kind === 'select'
                ? <select style={inputStyle} value={config[f.key]} onChange={e => set({ [f.key]: e.target.value })}>
                    {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                : <input style={inputStyle} type="number" inputMode="numeric" min={f.min} max={f.max} value={config[f.key]}
                    onChange={e => set({ [f.key]: Math.min(f.max, Math.max(f.min, Number(e.target.value) || f.min)) })}/>}
            </label>
          ))}
          <label className="m-fld"><span>Width</span>
            <select style={inputStyle} value={config.width || (t.half ? 'half' : 'full')} onChange={e => set({ width: e.target.value })}>
              {WIDTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            {editing && <button type="button" className="btn m-btn-lg" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => onRemove(widget)}>Remove</button>}
            <button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} disabled={!ready}
              onClick={() => onSave({ id: widget?.id || 'w' + Date.now().toString(36), type, config })}>{editing ? 'Save' : 'Add widget'}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export const newWidgetsAfterSave = (list, w) => (list.some(x => x.id === w.id) ? list.map(x => (x.id === w.id ? w : x)) : [...list, w]);
