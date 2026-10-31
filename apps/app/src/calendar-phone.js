// calendar-phone.js — the pure parts of the phone calendar: which events are on now or starting soon,
// where a Teams meeting is joined, moving an event later, and laying a day's events out on an hour
// timeline with overlapping events side by side.
export const SOON_MIN = 30;
export const TEAMS_RE = /https?:\/\/(?:teams\.microsoft\.com|teams\.live\.com)\/[^\s"'<>)]+/i;

const pad = (n) => String(n).padStart(2, '0');
export const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ms = (iso) => new Date(iso).getTime();

// 'now' while it is on, 'soon' when it starts within SOON_MIN minutes, otherwise ''.
export function eventBadge(ev, now = Date.now()) {
  const s = ms(ev?.start);
  if (Number.isNaN(s)) return '';
  const e = ev.end ? ms(ev.end) : s + 3600000;
  if (now >= s && now < e) return 'now';
  if (s > now && s - now <= SOON_MIN * 60000) return 'soon';
  return '';
}

// The meeting's join link: the one Outlook gave, else a Teams link written in the text.
export const joinUrlOf = (ev) => ev?.joinUrl || String(ev?.description || '').match(TEAMS_RE)?.[0] || '';

// The same event `minutes` later (start and end), as local stamps.
export function shiftEvent(ev, minutes) {
  const start = new Date(ms(ev.start) + minutes * 60000);
  const end = ev.end ? new Date(ms(ev.end) + minutes * 60000) : null;
  return { start: stamp(start), end: end ? stamp(end) : ev.end };
}

export const HOUR_PX = 52;
export const minutesOfDay = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

// Lay one day's events out: top and bottom in minutes, and a column of `cols` for events that overlap
// (so they sit side by side). Events shorter than `minLen` minutes are drawn at least that tall.
export function layoutDay(events, { minLen = 30 } = {}) {
  const items = (events || [])
    .filter(ev => !Number.isNaN(ms(ev.start)))
    .map(ev => {
      const startMin = minutesOfDay(ev.start);
      const len = ev.end ? Math.max(Math.round((ms(ev.end) - ms(ev.start)) / 60000), 0) : 60;
      return { ev, startMin, endMin: startMin + Math.max(len, minLen), col: 0, cols: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  let cluster = [], clusterEnd = -1;
  const close = () => { const cols = Math.max(1, ...cluster.map(i => i.col + 1)); cluster.forEach(i => { i.cols = cols; }); cluster = []; };
  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) close();
    const taken = new Set(cluster.filter(o => o.endMin > it.startMin).map(o => o.col));
    let c = 0; while (taken.has(c)) c++;
    it.col = c; cluster.push(it); clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) close();
  return items;
}

// The hours to draw: 7:00 to 21:00 unless an event falls outside, so nothing is cut off.
export function hourRange(items, from = 7, to = 21) {
  let a = from, b = to;
  for (const it of items) { a = Math.min(a, Math.floor(it.startMin / 60)); b = Math.max(b, Math.min(24, Math.ceil(it.endMin / 60))); }
  return [a, b];
}
