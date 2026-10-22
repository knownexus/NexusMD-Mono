// sync-triggers.js — DOM wiring for the core sync controller. Core stays DOM-free, so
// each webview host (web/desktop/app) passes these as dispatch / subscribe* options.

export const domDispatch = (name, detail) =>
  document.dispatchEvent(new CustomEvent(name, { detail }));
export const domSubscribeForeground = (cb) => {
  window.addEventListener('focus', cb);
  return () => window.removeEventListener('focus', cb);
};
export const domSubscribeChange = (cb) => {
  const h = () => cb();
  document.addEventListener('nexusmd:planner-changed', h);
  document.addEventListener('nexusmd:data-changed', h);
  return () => {
    document.removeEventListener('nexusmd:planner-changed', h);
    document.removeEventListener('nexusmd:data-changed', h);
  };
};
