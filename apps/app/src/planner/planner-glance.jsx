import React from 'react';
import { PL_OPEN, plTodayDate, plParseYmd, plIsOverdueYmd, plIsTodayYmd, StatusChip, PlModal } from './planner-ui.jsx';
import { Icon } from '../icons.jsx';
// planner-glance.jsx — Planner v2 "Week at a glance" overview + carry-over modal.
// Requires planner-ui.jsx. Confidential content is excluded via the rowVisible predicate.
const { useMemo: useMemoPG, useState: useStatePG } = React;

function glanceCollect(data, sections, rowVisible) {
  const items = [];
  sections.forEach(sec => {
    if (sec.type !== 'table') return;
    const dateCol = sec.cols.find(c => c.t === 'date');
    const mainCol = sec.cols.find(c => c.main) || sec.cols[0];
    (data[sec.id] || []).forEach(r => {
      if (rowVisible && !rowVisible(sec, r)) return;
      items.push({
        section: sec, row: r,
        title: r[mainCol.k] || '(untitled)',
        date: dateCol ? r[dateCol.k] : '',
        status: r.status || '',
      });
    });
  });
  return items;
}

function GlanceStat({ value, label, tone, onClick }) {
  return (
    <button className={`glance-stat ${tone || ''}`} onClick={onClick}>
      <span className="v">{value}</span>
      <span className="l">{label}</span>
    </button>
  );
}

function GlanceView({ data, themes, sections, groups, onOpenGroup, onOpenSection, carryCount, onOpenCarry, rowVisible }) {
  const items = useMemoPG(() => glanceCollect(data, sections, rowVisible), [data, sections, rowVisible]);
  const today = plTodayDate();

  const visRows = (id) => (data[id] || []).filter(r => !rowVisible || rowVisible(sections.find(s => s.id === id), r));
  const openTasks = visRows('tasks').filter(r => PL_OPEN(r.status || ''));
  const overdue = items.filter(i => plIsOverdueYmd(i.date, i.status));
  const dueToday = items.filter(i => plIsTodayYmd(i.date) && PL_OPEN(i.status));
  const blocked = items.filter(i => i.status === 'Blocked');
  const oneOnOnesOpen = visRows('oneOnOnes').filter(r => PL_OPEN(r.status || ''));
  const needsPrep = visRows('meetSched').filter(r => r.prep && r.prep.trim() && PL_OPEN(r.status || ''));

  const todayName = today.toLocaleDateString('en-US', { weekday: 'short' });
  const meetingsToday = visRows('meetSched').filter(r => (r.dayTime || '').toLowerCase().startsWith(todayName.toLowerCase()));
  const oneToday = visRows('oneOnOnes').filter(r => plIsTodayYmd(r.date));

  const attention = [
    ...overdue.map(i => ({ ...i, why: 'overdue' })),
    ...blocked.filter(i => !plIsOverdueYmd(i.date, i.status)).map(i => ({ ...i, why: 'blocked' })),
  ].slice(0, 6);

  const themesFilled = Object.values(themes || {}).filter(v => v && v.trim()).length;

  return (
    <div className="glance-grid">
      {carryCount > 0 && (
        <div className="span-12 pl-banner">
          <Icon name="refresh" size={15} style={{ color: 'var(--accent)', flexShrink: 0 }}/>
          <span style={{ flex: 1 }}>
            <strong>{carryCount} unfinished item{carryCount !== 1 ? 's' : ''}</strong> from last week haven't been carried over yet.
          </span>
          <button className="btn sm accent" onClick={onOpenCarry}>Review &amp; carry over</button>
        </div>
      )}

      <div className="span-12 glance-stats">
        <GlanceStat value={openTasks.length} label="Open tasks" onClick={() => onOpenSection('tasks')}/>
        <GlanceStat value={dueToday.length} label="Due today" tone={dueToday.length ? 'warn' : ''} onClick={() => onOpenSection('tasks')}/>
        <GlanceStat value={overdue.length} label="Overdue" tone={overdue.length ? 'alert' : ''} onClick={() => onOpenSection('tasks')}/>
        <GlanceStat value={oneOnOnesOpen.length} label="1:1s remaining" onClick={() => onOpenSection('oneOnOnes')}/>
        <GlanceStat value={needsPrep.length} label="Meetings need prep" onClick={() => onOpenSection('meetSched')}/>
      </div>

      {/* Today */}
      <div className="span-7">
        <div className="card">
          <div className="card-head"><h3><span style={{ color: 'var(--text-subtle)', display: 'flex' }}><Icon name="sun" size={14}/></span>&nbsp;Today · {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3></div>
          <div className="card-body flush">
            {meetingsToday.length === 0 && oneToday.length === 0 && dueToday.length === 0 && (
              <div className="empty" style={{ padding: '26px 20px', fontSize: 12.5 }}>Clear day — nothing scheduled or due.</div>
            )}
            {meetingsToday.map(m => (
              <div key={m.id} className="glance-row" onClick={() => onOpenSection('meetSched')}>
                <span className="time">{(m.dayTime || '').replace(/^\w+\s*/, '') || '—'}</span>
                <div className="t">
                  <div className="ttl">{m.meeting}</div>
                  {m.prep && PL_OPEN(m.status || '') && <div className="sub">Prep: {m.prep}</div>}
                </div>
                <StatusChip value={m.status} readOnly stopClick/>
              </div>
            ))}
            {oneToday.map(p => (
              <div key={p.id} className="glance-row" onClick={() => onOpenSection('oneOnOnes')}>
                <span className="time">1:1</span>
                <div className="t">
                  <div className="ttl">{p.person}</div>
                  {p.points && <div className="sub">{p.points}</div>}
                </div>
                <StatusChip value={p.status} readOnly stopClick/>
              </div>
            ))}
            {dueToday.filter(i => i.section.id !== 'meetSched' && i.section.id !== 'oneOnOnes').map((i, idx) => (
              <div key={idx} className="glance-row" onClick={() => onOpenSection(i.section.id)}>
                <span className="time" style={{ color: 'var(--accent)' }}>due</span>
                <div className="t">
                  <div className="ttl">{i.title}</div>
                  <div className="sub">{i.section.title}</div>
                </div>
                <StatusChip value={i.status} readOnly stopClick/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Needs attention */}
      <div className="span-5">
        <div className="card">
          <div className="card-head"><h3><span style={{ color: 'var(--danger)', display: 'flex' }}><Icon name="alert" size={14}/></span>&nbsp;Needs attention</h3></div>
          <div className="card-body flush">
            {attention.length === 0 && <div className="empty" style={{ padding: '26px 20px', fontSize: 12.5 }}>Nothing overdue or blocked.</div>}
            {attention.map((i, idx) => (
              <div key={idx} className="glance-row" onClick={() => onOpenSection(i.section.id)}>
                <div className="t">
                  <div className="ttl">{i.title}</div>
                  <div className="sub">{i.section.title}{i.date && plParseYmd(i.date) ? ` · due ${plParseYmd(i.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>
                </div>
                <span className={`pill ${i.why === 'overdue' ? 'danger' : 'warning'}`}>{i.why}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Group cards */}
      <div className="span-12">
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-subtle)', margin: '6px 0 10px' }}>Sections</div>
        <div className="glance-groups">
          {groups.filter(g => g.ids && g.ids.length).map(g => {
            let total = 0, done = 0, alerts = 0;
            g.ids.forEach(id => {
              const sec = sections.find(s => s.id === id);
              if (!sec || sec.type !== 'table') return;
              const rows = visRows(id);
              total += rows.length;
              done += rows.filter(r => r.status === 'Done').length;
              const dateCol = sec.cols.find(c => c.t === 'date');
              alerts += rows.filter(r => r.status === 'Blocked' || (dateCol && plIsOverdueYmd(r[dateCol.k], r.status))).length;
            });
            const hasThemes = g.ids.includes('themes');
            const meta = [];
            if (total > 0) meta.push(`${total - done} open`);
            if (alerts > 0) meta.push(`${alerts} flagged`);
            if (hasThemes && themesFilled > 0) meta.push(`${themesFilled} themes noted`);
            if (g.ids.includes('eow')) meta.push('review');
            return (
              <button key={g.id} className="glance-group" onClick={() => onOpenGroup(g.id)}>
                <span className="gg-head">
                  <span className="ic"><Icon name={g.icon} size={15}/></span>
                  {g.label}
                  {alerts > 0 && <span className="pill danger" style={{ marginLeft: 'auto' }}>{alerts}</span>}
                </span>
                <span className="gg-meta">{meta.length ? meta.join(' · ') : 'Empty'}</span>
                <span className="gg-bar"><div style={{ width: total ? `${Math.round(done / total * 100)}%` : '0%' }}></div></span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Carry-over ────────────────────────────────────────────────
// prevData is the `data` half of the previous week's { data, themes } envelope.
function collectCarryItems(prevData, sections) {
  const out = [];
  if (!prevData) return out;
  sections.forEach(sec => {
    if (sec.type !== 'table') return;
    const dateCol = sec.cols.find(c => c.t === 'date');
    const mainCol = sec.cols.find(c => c.main) || sec.cols[0];
    (prevData[sec.id] || []).forEach(r => {
      if (!PL_OPEN(r.status || '')) return;
      out.push({
        key: sec.id + ':' + (r.id || Math.random()), section: sec, row: r,
        title: r._confidential ? null : (r[mainCol.k] || '(untitled)'),
        why: r.status === 'Blocked' ? 'blocked' : (dateCol && plIsOverdueYmd(r[dateCol.k], r.status)) ? 'overdue' : 'open',
      });
    });
  });
  return out;
}

function CarryOverModal({ open, onClose, items, prevLabel, onCarry }) {
  const [excluded, setExcluded] = useStatePG(() => new Set());
  const toggle = (key) => setExcluded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const selected = items.filter(i => !excluded.has(i.key));

  const bySection = useMemoPG(() => {
    const m = new Map();
    items.forEach(i => {
      if (!m.has(i.section.id)) m.set(i.section.id, { section: i.section, items: [] });
      m.get(i.section.id).items.push(i);
    });
    return [...m.values()];
  }, [items]);

  return (
    <PlModal open={open} onClose={onClose} icon="refresh" wide
      title="Carry over from last week"
      sub={`${items.length} unfinished item${items.length !== 1 ? 's' : ''} in ${prevLabel} — untick anything you want to drop`}
      footerLeft={`${selected.length} of ${items.length} selected`}
      footer={(
        <React.Fragment>
          <button className="btn ghost" onClick={onClose}>Not now</button>
          <button className="btn primary" disabled={selected.length === 0} onClick={() => onCarry(selected)}>
            Carry over {selected.length || ''}
          </button>
        </React.Fragment>
      )}>
      {bySection.map(({ section, items: secItems }) => (
        <div key={section.id} className="co-group">
          <div className="co-group-head"><Icon name={section.icon || 'list'} size={12}/> {section.title}</div>
          {secItems.map(i => {
            const checked = !excluded.has(i.key);
            return (
              <label key={i.key} className="co-row">
                <input type="checkbox" checked={checked} onChange={() => toggle(i.key)} style={{ accentColor: 'var(--accent)', width: 15, height: 15, flexShrink: 0, margin: 0 }}/>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: checked ? 1 : 0.45, fontStyle: i.title === null ? 'italic' : 'normal', color: i.title === null ? 'var(--text-subtle)' : 'inherit' }}>
                  {i.title === null ? '🔒 Confidential entry (carried as-is)' : i.title}
                </span>
                <span className={`pill why ${i.why === 'overdue' ? 'danger' : i.why === 'blocked' ? 'warning' : ''}`}>{i.why}</span>
              </label>
            );
          })}
        </div>
      ))}
      {items.length === 0 && <div className="plm-callout ok">Nothing left unfinished last week — clean slate.</div>}
    </PlModal>
  );
}

Object.assign(window, { GlanceView, glanceCollect, collectCarryItems, CarryOverModal });
export { GlanceStat, GlanceView, CarryOverModal };