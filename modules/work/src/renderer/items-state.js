import React from 'react';

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

// Owns the desktop's `localItems` (null = mirror snapshot.WORK_ITEMS). Optimistic
// edits live here until the next snapshot (refresh, hide/restore), which resets the
// sentinel so the views show the new data. Returns [localItems, setItems], where
// setItems resolves the sentinel against the current snapshot first.
export function useLocalItems(snapshot) {
  const [localItems, setLocalItems] = React.useState(null);
  React.useEffect(() => { setLocalItems(null); }, [snapshot]);
  const workItems = snapshot?.WORK_ITEMS;
  const setItems = React.useCallback(
    updater => setLocalItems(prev => resolveItemsUpdate(prev, updater, workItems)),
    [workItems],
  );
  return [localItems, setItems];
}
