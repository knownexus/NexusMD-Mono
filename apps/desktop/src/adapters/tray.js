export const trayAdapter = {
  show()            { window.electronAPI?.tray.show() },
  hide()            { window.electronAPI?.tray.hide() },
  setTooltip(text)  { window.electronAPI?.tray.setTooltip(text) },
  setContextMenu(items) {
    window.electronAPI?.tray.setContextMenu(
      (items || []).map(item => ({
        label:   item.label,
        type:    item.type,
        enabled: item.enabled,
      }))
    );
  },
  onActivate(cb) {
    window.electronAPI?.tray.onActivate(cb);
    return () => {};
  },
  isAvailable() { return !!(window.electronAPI?.tray) },
}
