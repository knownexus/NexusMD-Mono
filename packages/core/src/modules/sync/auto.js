// auto.js — background sync scheduler: interval + foreground + change-debounce triggers.
import { rendererLog, ignored } from '../../log.js'

const log = rendererLog('sync', 'auto')
export function startAutoSync({
  syncNow,
  intervalMs = 300000,
  subscribeForeground,
  subscribeChange,
  debounceMs = 5000,
}) {
  let stopped = false;
  let debounceTimer = null;
  const unsubscribes = [];

  const safeSync = () => { syncNow().catch(ignored(log, 'a background sync failed; the next trigger tries again', 'warn')); };

  const intervalId = setInterval(() => {
    if (!stopped) safeSync();
  }, intervalMs);

  if (subscribeForeground) {
    const unsub = subscribeForeground(() => {
      if (!stopped) safeSync();
    });
    if (unsub) unsubscribes.push(unsub);
  }

  if (subscribeChange) {
    const unsub = subscribeChange(() => {
      if (stopped) return;
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!stopped) safeSync();
      }, debounceMs);
    });
    if (unsub) unsubscribes.push(unsub);
  }

  function stop() {
    stopped = true;
    clearInterval(intervalId);
    if (debounceTimer != null) { clearTimeout(debounceTimer); debounceTimer = null; }
    for (const unsub of unsubscribes) unsub();
  }

  return stop;
}
