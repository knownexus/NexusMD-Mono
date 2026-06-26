export const navigationAdapter = {
  onBackButton(cb) {
    const handler = () => cb();
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  },
  canGoBack()          { return window.history.length > 1 },
  goBack()             { window.history.back() },
  setBackButtonHandler(cb) {
    const handler = (e) => { e.preventDefault(); cb(); };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  },
}
