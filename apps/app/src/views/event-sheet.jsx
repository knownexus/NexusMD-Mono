// event-sheet.jsx — what you can do with a calendar event on the phone: join the meeting, add it to
// Planner, move it 30 minutes later, open its details, delete it. Events that come from Outlook are
// read-only here, so they only offer Join, Add to Planner and Details.
import React from 'react';
import { Icon } from '../icons.jsx';
import { Sheet } from '../components.jsx';
import { joinUrlOf, eventBadge } from '../calendar-phone.js';

const when = (ev) => {
  const t = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = new Date(ev.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  return `${day} · ${t(ev.start)}${ev.end ? ` – ${t(ev.end)}` : ''}`;
};

export function EventSheet({ ev, onClose, onMoveLater, onAddToPlanner, onDetails, onDelete, canAddToPlanner }) {
  if (!ev) return <Sheet open={false} onClose={onClose}/>;
  const url = joinUrlOf(ev);
  const local = ev.source !== 'outlook' && ev.source !== 'google';
  const badge = eventBadge(ev);
  const day = ev.start.slice(0, 10);
  const canPlan = !ev.plannerSection && !!canAddToPlanner?.(day);

  return (
    <Sheet open icon="planner" title={ev.title} sub={`${when(ev)}${badge === 'now' ? ' · On now' : badge === 'soon' ? ' · Starting soon' : ''}`} onClose={onClose}>
      {ev.description && !url && <div className="m-hint" style={{ marginTop: 0, marginBottom: 10 }}>{ev.description}</div>}
      <div className="m-card flush">
        {url && (
          <a className="m-row" href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="m-fileic"><Icon name="link" size={17}/></span>
            <div className="m-row-main"><div className="m-row-title">Join Teams meeting</div></div>
          </a>
        )}
        {canPlan && (
          <div className="m-row" onClick={() => { onAddToPlanner(ev); onClose(); }}>
            <span className="m-fileic"><Icon name="planner" size={17}/></span>
            <div className="m-row-main"><div className="m-row-title">Add to Planner</div><div className="m-row-sub">Adds it to Meetings - schedule</div></div>
          </div>
        )}
        {ev.plannerSection && (
          <div className="m-row" style={{ cursor: 'default' }}>
            <span className="m-fileic"><Icon name="check" size={17}/></span>
            <div className="m-row-main"><div className="m-row-title">In Planner</div></div>
          </div>
        )}
        {local && (
          <div className="m-row" onClick={() => { onMoveLater(ev); onClose(); }}>
            <span className="m-fileic"><Icon name="clock" size={17}/></span>
            <div className="m-row-main"><div className="m-row-title">Move 30 minutes later</div></div>
          </div>
        )}
        <div className="m-row" onClick={() => { onDetails(ev); onClose(); }}>
          <span className="m-fileic"><Icon name="doc" size={17}/></span>
          <div className="m-row-main"><div className="m-row-title">Open details</div></div>
        </div>
        {local && (
          <div className="m-row" onClick={() => { onDelete(ev.id); onClose(); }}>
            <span className="m-fileic" style={{ color: 'var(--danger)' }}><Icon name="trash" size={17}/></span>
            <div className="m-row-main"><div className="m-row-title" style={{ color: 'var(--danger)' }}>Delete</div></div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
