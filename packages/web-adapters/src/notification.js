export const notificationAdapter = {
  send(title, body, opts = {}) {
    if (!('Notification' in window)) return
    if (Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: opts.icon, tag: opts.tag })
      if (opts.onClick) n.onclick = opts.onClick
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        if (perm !== 'granted') return
        const n = new Notification(title, { body, icon: opts.icon, tag: opts.tag })
        if (opts.onClick) n.onclick = opts.onClick
      })
    }
  },
}
