import { deepLinkAdapter } from '../adapters/deepLink.js'

// What nexusmd:// links do in the shell:
//   nexusmd://open/<view>     switches to that screen (an app's id, or "settings"); one that is not
//                             installed here is ignored
//   nexusmd://oauth/...       the one-time code of a cloud sign-in (handled by `redeem`)
// The window is brought forward by the main process; this only picks the screen.

// The screen a link asks for, or null when it is not an open link.
export function viewFromLink(url) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'nexusmd:' || u.hostname !== 'open') return null
  const view = u.pathname.replace(/^\/+|\/+$/g, '')
  return /^[a-z0-9-]+$/.test(view) ? view : null
}

// One listener for all links (the bridge keeps a single one), and the link the app was started with.
export function registerDeepLinks({ redeem, navigate, adapter = deepLinkAdapter }) {
  if (!adapter.isAvailable()) return
  const handle = url => {
    const view = viewFromLink(url)
    if (view) navigate(view)
    else redeem(url)
  }
  adapter.onLink(handle)
  adapter.takeInitial().then(url => { if (url) handle(url) }).catch(() => {})
}
