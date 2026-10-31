// nav-config.js — which screens sit in the bottom bar / side rail and which in More, and in what
// order. The choice is saved as two lists, { bar, more }; anything not in a saved list (a screen that
// is new, or was switched back on) goes to the end of More, and anything unavailable is skipped.
export const PHONE_BAR_MAX = 5;

const byId = (tabs) => new Map(tabs.map(t => [t.id, t]));
const uniq = (ids) => [...new Set(ids)];

// `available` is every screen this profile can show; `defaults` is the bar when nothing is saved.
// `max` caps the bar (a phone has room for five); what does not fit goes to the front of More.
export function resolveNav(available, pref, defaults, { max = Infinity } = {}) {
  const map = byId(available);
  const barIds = uniq((pref?.bar ?? defaults).filter(id => map.has(id)));
  const moreSaved = uniq((pref?.more ?? []).filter(id => map.has(id) && !barIds.includes(id)));
  const rest = available.map(t => t.id).filter(id => !barIds.includes(id) && !moreSaved.includes(id));
  // With nothing saved, More keeps the screens' own order; otherwise new screens trail the saved ones.
  const moreIds = [...moreSaved, ...rest];
  const shown = barIds.slice(0, max);
  const spill = barIds.slice(max);
  return { bar: shown.map(id => map.get(id)), more: [...spill, ...moreIds].map(id => map.get(id)) };
}

const ids = (list) => list.map(t => t.id);
export const fromResolved = ({ bar, more }) => ({ bar: ids(bar), more: ids(more) });

// Swap an entry with its neighbour inside one list.
export function move(list, id, dir) {
  const i = list.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// Moves a screen between the bar and More. Pinning is refused when the bar is full, and the bar
// never goes empty: Home or Work have to stay reachable.
export function setPinned(pref, id, pinned, { max = PHONE_BAR_MAX } = {}) {
  const bar = pref.bar.filter(x => x !== id), more = pref.more.filter(x => x !== id);
  if (pinned) {
    if (pref.bar.includes(id)) return { pref, error: '' };
    if (pref.bar.length >= max) return { pref, error: `The bar holds ${max}. Move one to More first.` };
    return { pref: { bar: [...bar, id], more }, error: '' };
  }
  if (!pref.bar.includes(id)) return { pref, error: '' };
  if (bar.length === 0) return { pref, error: 'Keep at least one screen in the bar.' };
  return { pref: { bar, more: [id, ...more] }, error: '' };
}

export const moveInBar = (pref, id, dir) => ({ ...pref, bar: move(pref.bar, id, dir) });
export const moveInMore = (pref, id, dir) => ({ ...pref, more: move(pref.more, id, dir) });

export function parsePref(raw) {
  try {
    const p = JSON.parse(raw || 'null');
    return p && Array.isArray(p.bar) && Array.isArray(p.more) ? { bar: p.bar.map(String), more: p.more.map(String) } : null;
  } catch { return null; }
}
