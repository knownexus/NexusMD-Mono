// The desktop keeps `localItems` as a null sentinel meaning "mirror the ADO
// snapshot" (see main.jsx: items = localItems ?? data.WORK_ITEMS). Only once the
// user edits an item does it hold an array. Shared @nexusmd/ui views assign via
// setItems(arr => arr.map(...)), which assumes an array — so a functional update
// while the sentinel is still null throws "Cannot read properties of null
// (reading 'map')". Resolve the sentinel to the current snapshot first.
export function resolveItemsUpdate(prev, updater, fallback) {
  const base = prev ?? fallback ?? [];
  return typeof updater === 'function' ? updater(base) : updater;
}
