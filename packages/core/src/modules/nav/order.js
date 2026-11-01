// nav-order.js — the order of the screens in the bottom bar, More menu and tablet sidebar. The two groups stay
// as they are (what is in the main bar and what is under More); the order inside each group is the user's.
// One saved list of screen ids (`navOrder`, per profile) covers both groups.

// `tabs` in the user's order. Tabs the saved list does not mention (a screen added later) keep their default
// order after the ones it does, and ids in the list that no longer exist are ignored.
export function orderTabs(tabs, order) {
  if (!Array.isArray(order) || order.length === 0) return tabs;
  const byId = new Map(tabs.map(t => [t.id, t]));
  const seen = new Set();
  const first = [];
  for (const id of order) {
    if (byId.has(id) && !seen.has(id)) { seen.add(id); first.push(byId.get(id)); }
  }
  return [...first, ...tabs.filter(t => !seen.has(t.id))];
}

// The saved list after moving `id` one place up (dir -1) or down (+1) among `groupTabs`, which are shown in
// their current order. The other group's saved order is kept as it was.
export function moveTab(order, groupTabs, id, dir) {
  const ids = orderTabs(groupTabs, order).map(t => t.id);
  const from = ids.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= ids.length) return Array.isArray(order) ? order : [];
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return [...ids, ...(Array.isArray(order) ? order : []).filter(x => !ids.includes(x))];
}

// Splits `primary` and `secondary` (the default bar and More groups) again after the user's moves. `placement` maps a
// screen id to 'main' (bottom bar / sidebar), 'footer' (the tablet sidebar's footer) or 'more'; screens it does not
// mention stay where they started. `defaultFooter` names the screens that start in the footer, on a tablet. On a phone
// there is no footer: those screens sit in More.
export function placeTabs(primary, secondary, placement, { tablet = false, defaultFooter = [] } = {}) {
  const p = placement && typeof placement === 'object' ? placement : {};
  const main = new Set(primary.map(t => t.id));
  const where = (t) => {
    const w = p[t.id];
    if (w === 'main' || w === 'more') return w;
    if (w === 'footer') return tablet ? 'footer' : 'more';
    if (main.has(t.id)) return 'main';
    return tablet && defaultFooter.includes(t.id) ? 'footer' : 'more';
  };
  const all = [...primary, ...secondary];
  return {
    primary: all.filter(t => where(t) === 'main'),
    footer: all.filter(t => where(t) === 'footer'),
    secondary: all.filter(t => where(t) === 'more'),
  };
}
