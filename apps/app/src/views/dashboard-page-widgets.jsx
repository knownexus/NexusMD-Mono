// dashboard-page-widgets.jsx — a Home widget for each page that has none of its own (the work, PR, build and test
// cards live in view-dashboard.jsx). Pages with data show it; the rest are one-tap shortcuts. All are toggled in
// Settings > Appearance through `hiddenDashWidgets`, and a widget is not shown when its page is switched off.
import { Icon } from '../icons.jsx';
import { HelmData } from '../data.jsx';
import { getProfileKey } from '../profile-keys.js';
import { TimeWidget, NotesWidget, ReposWidget } from './dashboard-interactive-widgets.jsx';

export const PAGE_WIDGETS = [
  { id: 'calendar', page: 'calendar', title: 'Today', desc: 'Today’s calendar events' },
  { id: 'planner',  page: 'planner',  title: 'Planner tasks', desc: 'Your open planner tasks' },
  { id: 'lists',    page: 'lists',    title: 'Lists', desc: 'Your lists and their item counts' },
  { id: 'team',     page: 'team',     title: 'Team', desc: 'Who is around' },
  { id: 'triage',   page: 'triage',   title: 'Triage', desc: 'Shortcut to triage', icon: 'inbox' },
  { id: 'time',     page: 'time',     title: 'Time log', desc: 'Shortcut to log time', icon: 'clock' },
  { id: 'notes',    page: 'notes',    title: 'Notes', desc: 'Shortcut to notes', icon: 'pin' },
  { id: 'markdown', page: 'markdown', title: 'Documents', desc: 'Shortcut to documents', icon: 'doc' },
  { id: 'api',      page: 'api',      title: 'API Client', desc: 'Shortcut to the API client', icon: 'link' },
  { id: 'editor',   page: 'editor',   title: 'Editor', desc: 'Shortcut to the editor', icon: 'edit' },
  { id: 'git',      page: 'git',      title: 'Repos', desc: 'Shortcut to repos', icon: 'git-branch' },
];

const sameDay = (iso, d) => typeof iso === 'string' && iso.slice(0, 10) === d;
const readLists = () => { try { return JSON.parse(localStorage.getItem(getProfileKey('helm.lists')) || '{}').lists || []; } catch { return []; } };

function Card({ icon, title, meta, onMore, children }) {
  return (
    <div className="m-card" style={{ marginBottom: 12 }}>
      <div className="m-card-h">
        <span className="ic"><Icon name={icon} size={15}/></span>
        <h3>{title}</h3>
        {meta != null && <span className="meta">{meta}</span>}
        {onMore && <button type="button" className="m-linkbtn" onClick={onMore}>Open</button>}
      </div>
      {children && <div className="m-card-body flush">{children}</div>}
    </div>
  );
}
const Row = ({ title, sub, onClick }) => (
  <div className="m-row" onClick={onClick}>
    <div className="m-row-main">
      <div className="m-row-title">{title}</div>
      {sub ? <div className="m-row-meta"><span className="m-id">{sub}</span></div> : null}
    </div>
    <Icon name="chevron-right" size={16} className="chev"/>
  </div>
);
const Empty = ({ text }) => <div className="m-row-sub" style={{ padding: 16 }}>{text}</div>;

export function PageWidgets({ hidden = [], offScreens = [], calendarEvents = [], plannerData = {}, team = [], navTo, showMarkdown = true }) {
  const show = (w) => !hidden.includes(w.id) && !offScreens.includes(w.page) && (w.id !== 'markdown' || showMarkdown);
  const today = new Date().toISOString().slice(0, 10);
  return PAGE_WIDGETS.filter(show).map(w => {
    const go = () => navTo(w.page);
    if (w.id === 'time') return <TimeWidget key={w.id} storageKey={getProfileKey('nexusmd.timelog.v1')} navTo={navTo}/>;
    if (w.id === 'notes') return <NotesWidget key={w.id} navTo={navTo}/>;
    if (w.id === 'git') return <ReposWidget key={w.id} navTo={navTo}/>;
    if (w.id === 'calendar') {
      const ev = (calendarEvents || []).filter(e => sameDay(e.start, today)).sort((a, b) => String(a.start).localeCompare(String(b.start))).slice(0, 5);
      return (
        <Card key={w.id} icon="planner" title={w.title} meta={ev.length} onMore={go}>
          {ev.length === 0 ? <Empty text="Nothing on today."/> : ev.map((e, i) => (
            <Row key={e.id || i} title={e.title || 'Event'} sub={e.start.length > 10 ? new Date(e.start).toTimeString().slice(0, 5) : 'All day'} onClick={go}/>
          ))}
        </Card>
      );
    }
    if (w.id === 'planner') {
      const open = (plannerData.tasks || []).filter(t => t.status !== 'Done' && (t.task || '').trim());
      return (
        <Card key={w.id} icon="planner" title={w.title} meta={open.length} onMore={go}>
          {open.length === 0 ? <Empty text="No open tasks."/> : open.slice(0, 5).map((t, i) => (
            <Row key={t.id || i} title={t.task} sub={[t.status, t.due].filter(Boolean).join(' · ')} onClick={go}/>
          ))}
        </Card>
      );
    }
    if (w.id === 'lists') {
      const lists = readLists();
      return (
        <Card key={w.id} icon="work" title={w.title} meta={lists.length} onMore={go}>
          {lists.length === 0 ? <Empty text="No lists yet."/> : lists.slice(0, 5).map(l => (
            <Row key={l.id} title={l.name || l.title || 'List'} sub={`${(l.items || []).length} items`} onClick={go}/>
          ))}
        </Card>
      );
    }
    if (w.id === 'team') {
      const members = (team.length ? team : HelmData?.TEAM || []).slice(0, 5);
      return (
        <Card key={w.id} icon="team" title={w.title} meta={members.length} onMore={go}>
          {members.length === 0 ? <Empty text="No team members."/> : members.map(m => (
            <Row key={m.id} title={m.name} sub={[m.role, m.status].filter(Boolean).join(' · ')} onClick={go}/>
          ))}
        </Card>
      );
    }
    return (
      <div key={w.id} className="m-card" style={{ marginBottom: 12, cursor: 'pointer' }} onClick={go}>
        <div className="m-card-h" style={{ borderBottom: 0 }}>
          <span className="ic"><Icon name={w.icon} size={15}/></span>
          <h3>{w.title}</h3>
          <Icon name="chevron-right" size={16} className="chev"/>
        </div>
      </div>
    );
  });
}
