// sync-status.js — the "Updated 5m ago" line on Home.
export function syncLabel(loadedAt, now = Date.now()) {
  if (!loadedAt) return '';
  const mins = Math.floor((now - loadedAt) / 60000);
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `Updated ${hrs}h ago` : `Updated ${Math.floor(hrs / 24)}d ago`;
}

// What the offline banner says, with how many changes are waiting to be sent.
export const offlineText = (pending) => (pending > 0
  ? `Offline. ${pending} change${pending === 1 ? '' : 's'} saved, and will sync when you're back.`
  : 'Offline. Changes are saved and sync later.');
