// home-widgets.jsx — the optional widgets on Home, shared by the apps. None are there until you add one. Each is
// configured when it is made, stays as configured, and can be added more than once. The list lives in the
// `homeWidgets` tweak as { id, type, config }; the pure configuration (types, defaults, fields) is in @nexusmd/core.
//
// Everything a widget reads comes in through `ctx`, which the app builds:
//   navTo(page, filter?, repoId?), onOpenPR(pr), onOpenItem(workItem), needsMe(pr), isTerminalState(state),
//   openTarget(target) and resolveTarget(target) → { ok, reason? } for File-or-folder shortcuts (core shortcuts),
//   prs, builds, tests, workItems, me (current user id), team, calendarEvents, plannerData, lists,
//   timer (a store: load/save/loadPaused/savePaused, see storageTimerStore), notes ({ load, save }),
//   onCreateBug(detail), ArtifactsSheet ({ build, onClose }).
// Missing fields render as empty states; nothing here reads app globals or storage.
import React from 'react';
import {
  WIDGET_CONFIG_TYPES, pageLabel, widgetPage, readTarget, shortcutTitle, shortcutSub, shortcutIcon, LINK_UNAVAILABLE,
} from '@nexusmd/core';
import { Sheet as DefaultSheet } from './app-components.jsx';
import { Icon } from './icons.jsx';
import { Card, TimeWidget, NotesWidget, LatestBuild, LatestTest } from './dashboard-interactive-widgets.jsx';
import { TargetPicker } from './target-picker.jsx';

const { useState, useEffect } = React;
const arr = (v) => (Array.isArray(v) ? v : []);
const sameDay = (iso, d) => typeof iso === 'string' && iso.slice(0, 10) === d;
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
const nav = (x, ...a) => x.navTo?.(...a);

// A File-or-folder shortcut. One the host cannot open here (its repo is not on this device, its document is
// gone) is greyed, and tapping it says why instead of going anywhere.
const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
function LinkTile({ config, ctx }) {
  const [why, setWhy] = useState('');
  const t = readTarget(config);
  const res = !t ? { ok: false, reason: LINK_UNAVAILABLE.invalid } : ctx.resolveTarget ? ctx.resolveTarget(t) : { ok: true };
  const ok = res?.ok !== false;
  const go = () => { if (ok) { setWhy(''); ctx.openTarget?.(t); } else setWhy(res?.reason || LINK_UNAVAILABLE.invalid); };
  return (
    <div className="m-card" role="button" tabIndex={0} aria-disabled={!ok} style={{ marginBottom: 12, cursor: 'pointer', opacity: ok ? 1 : 0.55 }}
      onClick={go} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }}>
      <div className="m-card-h" style={{ borderBottom: 0, gap: 10, paddingRight: 36 }}>
        <Icon name={shortcutIcon(t)} size={16}/>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={ellipsis}>{shortcutTitle(t)}</h3>
          <div className="m-row-sub" style={{ ...ellipsis, ...(why ? { whiteSpace: 'normal' } : {}) }}>{why || shortcutSub(t)}</div>
        </div>
        {ok && <Icon name="chevron-right" size={16} className="chev"/>}
      </div>
    </div>
  );
}

// ── The renderers, keyed like WIDGET_CONFIG_TYPES ─────────────────────────────────────────────────────────────
const WIDGET_RENDERERS = {
  pr: {
    render: (c, x) => {
      const prs = arr(x.prs);
      const list = c.filter === 'needsme' ? prs.filter(p => !!x.needsMe?.(p)) : c.filter === 'drafts' ? prs.filter(p => p.draft) : prs;
      return (
        <Card icon="pr" title={WIDGET_TYPES.pr.title(c)} meta={list.length} onMore={() => nav(x, 'pr')}>
          {list.length === 0 ? <Empty text="Nothing here."/> : list.slice(0, c.count).map(pr => (
            <Row key={pr.id} title={pr.title} sub={[pr.repo, pr.age].filter(Boolean).join(' · ')} onClick={() => x.onOpenPR?.(pr)}/>
          ))}
        </Card>
      );
    },
  },
  builds: {
    render: (c, x) => {
      const list = arr(x.builds).slice(0, c.count);
      return (
        <Card icon="build" title="Builds" onMore={() => nav(x, 'builds')}>
          {list.length === 0 ? <Empty text="No builds."/>
            : <LatestBuild build={list[0]} navTo={x.navTo} onCreateBug={x.onCreateBug} ArtifactsSheet={x.ArtifactsSheet}/>}
          {list.slice(1).map(b => (
            <Row key={b.id} title={b.pipeline || 'Pipeline'}
              sub={[b.status, b.branch && String(b.branch).replace(/^refs\/heads\//, '')].filter(Boolean).join(' · ')} onClick={() => nav(x, 'builds')}/>
          ))}
        </Card>
      );
    },
  },
  tests: {
    render: (c, x) => {
      const list = arr(x.tests).slice(0, c.count);
      return (
        <Card icon="check-circle" title="Test runs" onMore={() => nav(x, 'tests')}>
          {list.length === 0 ? <Empty text="No test runs."/> : <LatestTest run={list[0]} navTo={x.navTo} onCreateBug={x.onCreateBug}/>}
          {list.slice(1).map((t, i) => (
            <Row key={t.id || i} title={t.name || t.title || t.pipeline || 'Test run'} sub={t.result || t.status || ''} onClick={() => nav(x, 'tests')}/>
          ))}
        </Card>
      );
    },
  },
  repo: {
    render: (c, x) => (
      <Card icon="git-branch" title={c.repoName || 'Repo'}>
        <div style={{ padding: 12 }}>
          <button type="button" className="btn sm primary" style={{ width: '100%' }} onClick={() => nav(x, 'git', undefined, c.repoId)}>Open repo</button>
        </div>
      </Card>
    ),
  },
  mywork: {
    render: (c, x) => {
      const me = x.me;
      const terminal = x.isTerminalState || (() => false);
      const all = arr(x.workItems).filter(w => me && w.assignee === me && !terminal(w.state));
      return (
        <Card icon="work" title="Assigned to me" meta={all.length} onMore={() => nav(x, 'work')}>
          {all.length === 0 ? <Empty text="Nothing assigned."/> : all.slice(0, c.count).map(w => (
            <Row key={w.id} title={w.title} sub={[`#${w.displayId || String(w.id).replace(/^jira:/, '')}`, w.state].filter(Boolean).join(' · ')} onClick={() => x.onOpenItem?.(w)}/>
          ))}
        </Card>
      );
    },
  },
  calendar: {
    render: (c, x) => {
      const today = new Date().toISOString().slice(0, 10);
      const ev = arr(x.calendarEvents).filter(e => sameDay(e.start, today)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
      return (
        <Card icon="planner" title="Today" meta={ev.length} onMore={() => nav(x, 'calendar')}>
          {ev.length === 0 ? <Empty text="Nothing on today."/> : ev.slice(0, c.count).map((e, i) => (
            <Row key={e.id || i} title={e.title || 'Event'} sub={e.start.length > 10 ? new Date(e.start).toTimeString().slice(0, 5) : 'All day'} onClick={() => nav(x, 'calendar')}/>
          ))}
        </Card>
      );
    },
  },
  planner: {
    render: (c, x) => {
      const open = arr((x.plannerData || {}).tasks).filter(t => t.status !== 'Done' && (t.task || '').trim());
      return (
        <Card icon="planner" title="Planner tasks" meta={open.length} onMore={() => nav(x, 'planner')}>
          {open.length === 0 ? <Empty text="No open tasks."/> : open.slice(0, c.count).map((t, i) => (
            <Row key={t.id || i} title={t.task} sub={[t.status, t.due].filter(Boolean).join(' · ')} onClick={() => nav(x, 'planner')}/>
          ))}
        </Card>
      );
    },
  },
  lists: {
    // Shows every list. A widget pinned to one list (config.listId) whose list has since been deleted shows a
    // removed state instead of throwing.
    render: (c, x) => {
      const all = arr(x.lists).filter(l => l && typeof l === 'object');
      const pinned = c.listId ? all.filter(l => l.id === c.listId) : null;
      const lists = pinned || all;
      return (
        <Card icon="work" title="Lists" meta={lists.length} onMore={() => nav(x, 'lists')}>
          {pinned && !pinned.length ? <Empty text="This list was removed."/>
            : lists.length === 0 ? <Empty text="No lists yet."/>
            : lists.slice(0, c.count).map((l, i) => (
              <Row key={l.id || i} title={l.name || l.title || 'List'} sub={`${arr(l.items).length} items`} onClick={() => nav(x, 'lists')}/>
            ))}
        </Card>
      );
    },
  },
  team: {
    render: (c, x) => {
      const members = arr(x.team).slice(0, c.count);
      return (
        <Card icon="team" title="Team" meta={members.length} onMore={() => nav(x, 'team')}>
          {members.length === 0 ? <Empty text="No team members."/> : members.map(m => (
            <Row key={m.id} title={m.name} sub={[m.role, m.status].filter(Boolean).join(' · ')} onClick={() => nav(x, 'team')}/>
          ))}
        </Card>
      );
    },
  },
  time: {
    render: (c, x) => <TimeWidget timer={x.timer} navTo={x.navTo}/>,
  },
  notes: {
    render: (c, x) => <NotesWidget navTo={x.navTo} notes={x.notes || undefined}/>,
  },
  shortcut: {
    render: (c, x) => (
      <div className="m-card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={() => nav(x, c.to)}>
        <div className="m-card-h" style={{ borderBottom: 0 }}>
          <h3>{pageLabel(c.to)}</h3>
          <Icon name="chevron-right" size={16} className="chev"/>
        </div>
      </div>
    ),
  },
  link: {
    render: (c, x) => <LinkTile config={c} ctx={x}/>,
  },
};

export const WIDGET_TYPES = Object.fromEntries(
  Object.entries(WIDGET_CONFIG_TYPES).map(([k, t]) => [k, { ...t, render: WIDGET_RENDERERS[k].render }]),
);

const WIDTHS = [['half', 'Half width'], ['full', 'Full width']];
const widthOf = (w) => w.config?.width || (WIDGET_TYPES[w.type]?.half ? 'half' : 'full');

// One widget as it shows on Home, with its ⋯ (settings) button: what WidgetHost puts in each cell, and what
// the desktop Dashboard's own grid puts in its cells. Its parent must be positioned (the button is absolute).
export function WidgetBody({ widget: w, ctx = {}, onEdit }) {
  const t = WIDGET_TYPES[w.type];
  if (!t) return null;
  const c = { ...t.defaults, ...(w.config || {}) };
  return (
    <>
      {t.render(c, ctx || {})}
      <button type="button" className="m-iconbtn" aria-label={`Edit ${t.title ? t.title(c) : t.label} widget`}
        style={{ position: 'absolute', top: 2, right: 2, width: 30, height: 30, opacity: 0.7 }} onClick={() => onEdit?.(w)}>
        <Icon name="more" size={15}/>
      </button>
    </>
  );
}

// ── Host: the widgets, in a grid so half-width ones sit side by side ─────────────────────────────────────────
// Widgets of an unknown type, or whose page is in offScreens, are skipped.
export function WidgetHost({ widgets = [], offScreens = [], ctx = {}, onEdit }) {
  const shown = arr(widgets).filter(w => w && WIDGET_TYPES[w.type] && !offScreens.includes(widgetPage(w)));
  if (!shown.length) return null;
  const x = ctx || {};
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 12 }}>
      {shown.map(w => (
        <div key={w.id} style={{ gridColumn: widthOf(w) === 'half' ? 'span 1' : 'span 2', minWidth: 0, position: 'relative' }}>
          <WidgetBody widget={w} ctx={x} onEdit={onEdit}/>
        </div>
      ))}
    </div>
  );
}

// ── Add / edit ─────────────────────────────────────────────────────────────────────────────────────────────────
const inputStyle = { width: '100%', height: 40, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' };

function RepoPicker({ value, onPick, listRepoChoices }) {
  const [repos, setRepos] = useState(null);
  useEffect(() => {
    let live = true;
    if (!listRepoChoices) { setRepos([]); return undefined; }
    Promise.resolve().then(listRepoChoices).then(r => live && setRepos(arr(r?.repos))).catch(() => live && setRepos([]));
    return () => { live = false; };
  }, [listRepoChoices]);
  return (
    <select style={inputStyle} value={value} aria-label="Repository"
      onChange={e => { const r = (repos || []).find(x => x.id === e.target.value); onPick(r ? { repoId: r.id, repoName: r.name } : { repoId: '', repoName: '' }); }}>
      <option value="">{repos === null ? 'Loading repos…' : 'Choose a repo'}</option>
      {(repos || []).map(r => <option key={r.id} value={r.id}>{r.project ? `${r.project} / ${r.name}` : r.name}</option>)}
    </select>
  );
}

// One sheet for both: pick a type (new), set it up, Add / Save. Editing also offers Remove.
// `Sheet` defaults to the shared bottom sheet; `listRepoChoices()` → Promise<{ repos: [{ id, name, project? }] }>
// feeds the Repo widget's picker.
// showWidth=false leaves out the half/full Width choice, for a host that sizes widgets itself (desktop).
// `targetSources` is what lets a host create File-or-folder shortcuts here (what each kind can choose from: see
// target-picker.jsx); without it that type is not offered (the shortcuts a host pins from its viewers are still shown,
// and editable here).
export function WidgetSheet({ open, widget, offScreens = [], onClose, onSave, onRemove, Sheet = DefaultSheet, listRepoChoices, targetSources, showWidth = true }) {
  const editing = !!widget;
  const [type, setType] = useState(null);
  const [config, setConfig] = useState({});
  useEffect(() => {
    if (!open) return;
    if (widget && WIDGET_TYPES[widget.type]) { setType(widget.type); setConfig({ ...WIDGET_TYPES[widget.type].defaults, ...(widget.config || {}) }); }
    else { setType(null); setConfig({}); }
  }, [open, widget]);
  const t = type && WIDGET_TYPES[type];
  const choose = (k) => { setType(k); setConfig({ ...WIDGET_TYPES[k].defaults }); };
  // A File-or-folder shortcut being made is first picked (and can be picked again), then named.
  const picking = !!t && t.needsTarget && !editing && !readTarget(config);
  const set = (patch) => setConfig(c => ({ ...c, ...patch }));
  const ready = t && (!t.needsRepo || config.repoId) && (!t.needsTarget || readTarget(config));
  return (
    <Sheet open={open} icon="plus" title={editing ? 'Widget settings' : t ? `New ${t.label.toLowerCase()} widget` : 'Add a widget'} sub={editing ? t?.label : undefined} onClose={onClose}>
      {!t && (
        <div>
          {Object.entries(WIDGET_TYPES).filter(([, d]) => (!d.page || !offScreens.includes(d.page)) && (!d.needsTarget || targetSources)).map(([k, d]) => (
            <div key={k} className="m-row" onClick={() => choose(k)}>
              <span className="m-fileic"><Icon name={d.icon} size={16}/></span>
              <div className="m-row-main"><div className="m-row-title">{d.label}</div><div className="m-row-sub">{d.desc}</div></div>
              <Icon name="chevron-right" size={16} className="chev"/>
            </div>
          ))}
        </div>
      )}
      {picking && <TargetPicker sources={targetSources || []} onPick={target => set({ ...target })}/>}
      {t && !picking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 2px 8px' }}>
          {t.needsTarget && !editing && (
            <div className="m-fld"><span>Opens</span>
              <div className="m-row-title">{shortcutTitle({ ...config, label: '' })}</div>
              <div className="m-row-sub">{shortcutSub(config)}</div>
              <button type="button" className="m-linkbtn" style={{ marginTop: 4 }} onClick={() => setConfig({ ...t.defaults })}>Choose something else</button>
            </div>
          )}
          {t.needsRepo && (
            <label className="m-fld"><span>Repository{editing ? ' (fixed once made)' : ''}</span>
              {editing ? <div className="m-row-title">{config.repoName}</div> : <RepoPicker value={config.repoId} onPick={set} listRepoChoices={listRepoChoices}/>}
            </label>
          )}
          {t.needsTarget && editing && (
            <div className="m-fld"><span>Opens (fixed once made)</span>
              <div className="m-row-title">{shortcutTitle({ ...config, label: '' })}</div>
              <div className="m-row-sub">{shortcutSub(config)}</div>
            </div>
          )}
          {t.fields.map(f => (
            <label key={f.key} className="m-fld"><span>{f.label}</span>
              {f.kind === 'select'
                ? <select style={inputStyle} value={config[f.key]} onChange={e => set({ [f.key]: e.target.value })}>
                    {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                : f.kind === 'text'
                ? <input style={inputStyle} type="text" maxLength={60} value={config[f.key] ?? ''} onChange={e => set({ [f.key]: e.target.value })}/>
                : <input style={inputStyle} type="number" inputMode="numeric" min={f.min} max={f.max} value={config[f.key]}
                    onChange={e => set({ [f.key]: Math.min(f.max, Math.max(f.min, Number(e.target.value) || f.min)) })}/>}
            </label>
          ))}
          {showWidth && (
            <label className="m-fld"><span>Width</span>
              <select style={inputStyle} value={config.width || (t.half ? 'half' : 'full')} onChange={e => set({ width: e.target.value })}>
                {WIDTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {editing && <button type="button" className="btn m-btn-lg" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => onRemove(widget)}>Remove</button>}
            <button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} disabled={!ready}
              onClick={() => onSave({ id: widget?.id || 'w' + Date.now().toString(36), type, config: t.needsTarget ? readTarget(config) : config })}>{editing ? 'Save' : 'Add widget'}</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
