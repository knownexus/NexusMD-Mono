// auto.js — background sync scheduler: interval + foreground + change-debounce triggers.
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

  const safeSync = () => { syncNow().catch(() => {}); };

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
