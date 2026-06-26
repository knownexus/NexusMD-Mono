export const notificationAdapter = {
  send(title, body, _opts = {}) {
    window.electronAPI?.showNotification(title, body);
  },
}
