// day-timeline.jsx — the selected day on the phone calendar as an hour timeline: events as blocks
// (overlapping ones side by side), a line at the current time, and any empty hour tappable to add an
// event at that time.
import React from 'react';
import { layoutDay, hourRange, eventBadge, HOUR_PX, minutesOfDay } from '../calendar-phone.js';

const pad = (n) => String(n).padStart(2, '0');
const hm = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const LABEL_W = 48;

export function DayTimeline({ events, isToday, onPick, onAddAt }) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  const items = React.useMemo(() => layoutDay(events), [events]);
  const [from, to] = hourRange(items);
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const nowMin = minutesOfDay(new Date(now).toISOString());
  const nowTop = (new Date(now).getHours() * 60 + new Date(now).getMinutes() - from * 60) * HOUR_PX / 60;

  return (
    <div className="m-timeline" style={{ height: hours.length * HOUR_PX }} role="list" aria-label="Day timeline">
      {hours.map(h => (
        <button key={h} type="button" className="m-hour" style={{ top: (h - from) * HOUR_PX, height: HOUR_PX }}
          aria-label={`Add an event at ${pad(h)}:00`} onClick={() => onAddAt?.(`${pad(h)}:00`)}>
          <span className="lbl">{pad(h)}:00</span>
        </button>
      ))}
      {items.map(it => {
        const badge = eventBadge(it.ev, now);
        return (
          <button key={it.ev.id} type="button" role="listitem" className={`m-tl-ev${badge ? ` ${badge}` : ''}`}
            style={{
              top: (it.startMin - from * 60) * HOUR_PX / 60, height: Math.max((it.endMin - it.startMin) * HOUR_PX / 60 - 2, 22),
              left: `calc(${LABEL_W + 4}px + (100% - ${LABEL_W + 4}px) * ${it.col / it.cols})`,
              width: `calc((100% - ${LABEL_W + 4}px) / ${it.cols} - 3px)`,
            }}
            onClick={() => onPick?.(it.ev)}>
            <span className="t">{it.ev.title}</span>
            <span className="m">{hm(it.ev.start)}{badge === 'now' ? ' · Now' : badge === 'soon' ? ' · Soon' : ''}</span>
          </button>
        );
      })}
      {isToday && nowMin >= from * 60 && nowMin <= to * 60 && (
        <div className="m-nowline" style={{ top: nowTop }} aria-label="Now"><span/></div>
      )}
    </div>
  );
}
