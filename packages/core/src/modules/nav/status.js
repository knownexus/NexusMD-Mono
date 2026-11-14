// sync-status.js — the "Work data updated 5m ago" line on Home.
export function syncLabel(loadedAt, now = Date.now()) {
  if (!loadedAt) return '';
  const mins = Math.floor((now - loadedAt) / 60000);
  if (mins < 1) return 'Work data updated just now';
  if (mins < 60) return `Work data updated ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `Work data updated ${hrs}h ago` : `Work data updated ${Math.floor(hrs / 24)}d ago`;
}

// What the offline banner says, with how many changes are waiting to be sent.
export const offlineText = (pending) => (pending > 0
  ? `Offline. ${pending} change${pending === 1 ? '' : 's'} saved, and will be sent when you're back online.`
  : "Offline. Changes are saved and will be sent when you're back online.");
