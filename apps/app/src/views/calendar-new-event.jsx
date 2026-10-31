// calendar-new-event.jsx — the "New event" sheet on the phone calendar: a title, the day, a start
// time and a length, with the choice to also add it to Planner's Meetings and to Outlook.
import React from 'react';
import { Sheet } from '../components.jsx';

export const LENGTHS = [[15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1 hour 30'], [120, '2 hours'], [180, '3 hours']];

const pad = (n) => String(n).padStart(2, '0');
export const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

// The next whole hour if the day is today, otherwise 09:00.
export function defaultStart(dayKey, now = new Date()) {
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (dayKey !== todayKey) return '09:00';
  const h = Math.min(now.getHours() + 1, 23);
  return `${pad(h)}:00`;
}

// Checks the form and builds the event, or says what is wrong.
export function buildEvent({ title, day, time, length }, id = String(Date.now())) {
  const name = String(title || '').trim();
  if (!name) return { error: 'Give the event a title.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return { error: 'Choose a day.' };
  if (!/^\d{2}:\d{2}$/.test(time || '')) return { error: 'Choose a start time.' };
  const start = new Date(`${day}T${time}`);
  if (Number.isNaN(start.getTime())) return { error: 'That date or time is not valid.' };
  const end = new Date(start.getTime() + Number(length) * 60000);
  return { event: { id, title: name, start: localStamp(start), end: localStamp(end), type: 'meeting', description: '' } };
}

export function NewEventSheet({ open, onClose, dayKey, startTime, onAdd, canAddToPlanner, outlookConnected }) {
  const [title, setTitle] = React.useState('');
  const [day, setDay] = React.useState(dayKey);
  const [time, setTime] = React.useState(defaultStart(dayKey));
  const [length, setLength] = React.useState(30);
  const [toPlanner, setToPlanner] = React.useState(false);
  const [toOutlook, setToOutlook] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setTitle(''); setDay(dayKey); setTime(startTime || defaultStart(dayKey)); setLength(30);
    setToPlanner(false); setToOutlook(false); setError('');
  }, [open, dayKey, startTime]);

  const plannerOk = !!canAddToPlanner?.(day);
  const submit = () => {
    const r = buildEvent({ title, day, time, length });
    if (r.error) { setError(r.error); return; }
    onAdd(r.event, { toPlanner: toPlanner && plannerOk, toOutlook: toOutlook && !!outlookConnected });
    onClose();
  };

  return (
    <Sheet open={open} size="tall" icon="plus" title="New event" onClose={onClose}
      footer={<button type="button" className="btn primary m-btn-lg" style={{ flex: 1 }} onClick={submit}>Add event</button>}>
      <div className="m-fld">
        <label htmlFor="ev-title">Title</label>
        <input id="ev-title" autoFocus value={title} placeholder="Team sync" onChange={e => { setTitle(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }} aria-invalid={!!error && !title.trim()}/>
      </div>
      <div className="m-fld">
        <label htmlFor="ev-day">Day</label>
        <input id="ev-day" type="date" value={day} onChange={e => { setDay(e.target.value); setError(''); }}/>
      </div>
      <div className="row2 m-fld" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="m-fld" style={{ marginBottom: 0 }}>
          <label htmlFor="ev-time">Starts</label>
          <input id="ev-time" type="time" value={time} onChange={e => { setTime(e.target.value); setError(''); }}/>
        </div>
        <div className="m-fld" style={{ marginBottom: 0 }}>
          <label htmlFor="ev-len">Length</label>
          <select id="ev-len" className="m-select" value={length} onChange={e => setLength(Number(e.target.value))}>
            {LENGTHS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </select>
        </div>
      </div>

      <label className="m-switchrow">
        <input type="checkbox" checked={toPlanner && plannerOk} disabled={!plannerOk} onChange={e => setToPlanner(e.target.checked)}/>
        <span>Add to Planner<span className="m-hint" style={{ display: 'block', marginTop: 2 }}>
          {plannerOk ? 'Adds it to Meetings - schedule' : "Only for days in the week the Planner is showing"}</span></span>
      </label>
      {outlookConnected && (
        <label className="m-switchrow">
          <input type="checkbox" checked={toOutlook} onChange={e => setToOutlook(e.target.checked)}/>
          <span>Save to Outlook<span className="m-hint" style={{ display: 'block', marginTop: 2 }}>
            Off keeps it on this device only. It can't be undone here once sent.</span></span>
        </label>
      )}
      {error && <div className="m-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </Sheet>
  );
}
