export const deepLinkAdapter = {
  onLink(cb) {
    window.electronAPI?.onDeepLink(cb);
    return () => window.electronAPI?.removeDeepLinkListener();
  },
  isAvailable() { return !!(window.electronAPI?.onDeepLink) },
}
