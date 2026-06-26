export const badgeAdapter = {
  set(count)    { window.electronAPI?.badge.set(count) },
  clear()       { window.electronAPI?.badge.clear() },
  isAvailable() { return !!(window.electronAPI?.badge) },
}
