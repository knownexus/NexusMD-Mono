// wi-group-order.js — how Work Items groups are ordered. One saved setting per grouping,
// shared by the table and the board: { mode, keys }. `keys` is the custom order; groups it
// doesn't mention (new assignees, a project not seen before) follow in their default order.

export const GROUP_ORDER_MODES = [
  { id: 'default',   label: 'Default' },
  { id: 'name',      label: 'Name A–Z' },
  { id: 'name-desc', label: 'Name Z–A' },
  { id: 'count',     label: 'Most items' },
  { id: 'custom',    label: 'Custom' },
];

const byLabel = (a, b) => String(a.label ?? a.key).localeCompare(String(b.label ?? b.key), undefined, { numeric: true, sensitivity: 'base' });

export function orderGroups(groups, order) {
  const mode = order?.mode || 'default';
  if (mode === 'name')      return [...groups].sort(byLabel);
  if (mode === 'name-desc') return [...groups].sort((a, b) => byLabel(b, a));
  if (mode === 'count')     return [...groups].sort((a, b) => (b.items?.length ?? b.count ?? 0) - (a.items?.length ?? a.count ?? 0) || byLabel(a, b));
  if (mode === 'custom') {
    const rank = new Map((order.keys || []).map((k, i) => [k, i]));
    const pos = (g, i) => rank.has(g.key) ? rank.get(g.key) : rank.size + i;
    return groups.map((g, i) => [g, pos(g, i)]).sort((a, b) => a[1] - b[1]).map(([g]) => g);
  }
  return groups;
}

// A custom order from the groups as now shown, with `from` moved to `to`. Saved keys for
// groups not shown right now (filtered out, say) are kept at the end so they aren't lost.
export function moveGroup(shownKeys, savedKeys, from, to) {
  const keys = [...shownKeys];
  if (from < 0 || from >= keys.length || to < 0 || to >= keys.length || from === to) return null;
  const [k] = keys.splice(from, 1);
  keys.splice(to, 0, k);
  const shown = new Set(keys);
  return { mode: 'custom', keys: [...keys, ...(savedKeys || []).filter(x => !shown.has(x))] };
}
