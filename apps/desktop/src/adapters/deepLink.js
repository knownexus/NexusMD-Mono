export const deepLinkAdapter = {
  onLink(cb) {
    window.electronAPI?.onDeepLink(cb);
    return () => window.electronAPI?.removeDeepLinkListener();
  },
  isAvailable() { return !!(window.electronAPI?.onDeepLink) },
  // The link the app was started with, if any (taken once).
  takeInitial() { return window.electronAPI?.takeInitialDeepLink?.() ?? Promise.resolve(null) },
}
