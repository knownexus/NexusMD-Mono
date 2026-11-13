// pin-shortcut.js — "Pin to Home": a viewer (a file in the git browser, a document, an Editor file) asks for a
// File-or-folder shortcut to what it is showing, and the host that owns the Home widgets puts it there. One event
// joins them, so shared screens need not know which app they are in, and no screen reaches into another's code.
import { makeLinkWidget } from '@nexusmd/core'

export const PIN_EVENT = 'nexusmd:pin-shortcut'

/** Asks the host to put a shortcut to `target` (core shortcuts) on Home. false when it is not a usable target. */
export function pinToHome(target) {
  if (!makeLinkWidget(target)) return false
  window.dispatchEvent(new CustomEvent(PIN_EVENT, { detail: target }))
  return true
}

/**
 * The host's side: `onPin(widget)` for each request, the widget made for this host. An Editor path is only
 * meaningful on the kind of device that made it, so it is stamped with `platform` here, where that is known.
 * Returns the unsubscribe.
 */
export function listenForPins(onPin, platform) {
  const heard = (e) => {
    const t = e.detail
    const widget = makeLinkWidget(t && t.target === 'editor' ? { ...t, platform } : t)
    if (widget) onPin(widget)
  }
  window.addEventListener(PIN_EVENT, heard)
  return () => window.removeEventListener(PIN_EVENT, heard)
}
