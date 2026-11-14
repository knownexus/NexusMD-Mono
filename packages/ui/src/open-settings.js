// open-settings.js — "take me to Settings, on this tab" from anywhere (a toast's Review button, the sidebar's sync badge).
// The host shell answers the event by showing its Settings screen; the Settings screen answers it by switching tab. When
// Settings is not mounted yet the tab waits here until it is (takePendingSettingsTab), so the order of the two does not matter.
export const OPEN_SETTINGS_EVENT = 'nexusmd:open-settings';

// A request nobody picked up (no Settings screen on this host) must not surprise the next visit to Settings.
const PENDING_MS = 5000;
let pending = null; // { tab, at }

// The tab is noted when the event goes by, whoever sent it, so a plain dispatchEvent works as well as openSettings().
// This listener is added when the module loads, before any screen's, so it runs first.
if (typeof window !== 'undefined') {
  window.addEventListener(OPEN_SETTINGS_EVENT, (e) => {
    const asked = e && e.detail && typeof e.detail.tab === 'string' && e.detail.tab ? e.detail.tab : null;
    pending = asked ? { tab: asked, at: Date.now() } : null;
  });
}

/** Opens Settings on `tab` (an id such as 'data'); with none, on whichever tab it last showed. */
export function openSettings(tab) {
  const asked = typeof tab === 'string' && tab ? tab : null;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab: asked } }));
  else pending = asked ? { tab: asked, at: Date.now() } : null;
}

/**
 * The tab asked for and not yet shown, or null. It is cleared once the current turn is over rather than at once, so
 * reading it twice in one render (React runs a state initializer twice in development) gives the same answer.
 */
export function takePendingSettingsTab() {
  if (!pending) return null;
  const { tab, at } = pending;
  queueMicrotask(() => { if (pending && pending.at === at) pending = null; });
  return Date.now() - at <= PENDING_MS ? tab : null;
}
