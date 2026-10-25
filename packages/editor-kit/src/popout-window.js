import React from 'react'

// The main process allows a blank window only under this name (electron/link-window/window-open.cjs).
const FRAME = 'nexusmd-popout'
let count = 0

// The app's styles, copied as text so they apply in a blank window; a sheet that can't be
// read that way (cross-origin) is linked by its absolute address instead.
function copyStyles(from, to) {
  for (const sheet of Array.from(from.styleSheets)) {
    let text = null
    try { text = Array.from(sheet.cssRules, r => r.cssText).join('\n') } catch { text = null }
    if (text != null) {
      const style = to.createElement('style')
      style.textContent = text
      to.head.appendChild(style)
    } else if (sheet.href) {
      const link = to.createElement('link')
      link.rel = 'stylesheet'
      link.href = sheet.href
      to.head.appendChild(link)
    }
  }
}

// Theme and density live as attributes on <html>, so they are mirrored as they change.
function mirrorRoot(from, to) {
  const copy = () => {
    for (const a of Array.from(to.attributes)) if (!from.hasAttribute(a.name)) to.removeAttribute(a.name)
    for (const a of Array.from(from.attributes)) to.setAttribute(a.name, a.value)
  }
  copy()
  const watch = new MutationObserver(copy)
  watch.observe(from, { attributes: true })
  return () => watch.disconnect()
}

/**
 * A separate window that a component renders into with a portal, so it stays live.
 * open() returns false when the window couldn't be opened. The window closes when the
 * owner unmounts; onClosed runs when the person closes it themselves.
 */
export function usePopoutWindow({ title, onClosed }) {
  const [popout, setPopout] = React.useState(null)
  const current = React.useRef(null)
  current.current = popout
  const closedRef = React.useRef(onClosed)
  closedRef.current = onClosed

  const open = React.useCallback(() => {
    const name = `${FRAME}-${++count}`
    let w = null
    try { w = window.open('about:blank', name, 'width=820,height=600') } catch { w = null }
    if (!w || !w.document) return false
    const doc = w.document
    doc.title = title
    copyStyles(document, doc)
    const unmirror = mirrorRoot(document.documentElement, doc.documentElement)
    doc.body.className = document.body.className
    doc.body.style.margin = '0'
    const root = doc.createElement('div')
    root.className = 'nx-popout-root'
    doc.body.appendChild(root)
    setPopout({ w, root, unmirror })
    return true
  }, [title])

  const close = React.useCallback(() => {
    const p = current.current
    if (p) { p.unmirror(); if (!p.w.closed) p.w.close() }
    setPopout(null)
  }, [])

  // The person closing the window: pagehide where it fires, a poll as the fallback.
  React.useEffect(() => {
    if (!popout) return undefined
    let done = false
    const gone = () => {
      if (done) return
      done = true
      popout.unmirror()
      setPopout(null)
      closedRef.current?.()
    }
    popout.w.addEventListener?.('pagehide', gone)
    const poll = setInterval(() => { if (popout.w.closed) gone() }, 500)
    return () => { done = true; clearInterval(poll); popout.w.removeEventListener?.('pagehide', gone) }
  }, [popout])

  React.useEffect(() => { if (popout) popout.w.document.title = title }, [popout, title])
  // Closing the owner closes its window too (read from a ref: state updaters don't run after unmount).
  React.useEffect(() => () => {
    const p = current.current
    if (p) { p.unmirror(); if (!p.w.closed) p.w.close() }
  }, [])

  return { root: popout?.root ?? null, open, close }
}
