import React from 'react'
import { ansiToSpans, stripAnsi } from '@nexusmd/core'
import { ANSI_COLORS } from './run-drawer.jsx'

const STICK_PX = 24
const SIDE_KEY = 'nexusmd.outputSide'
const SIZE_KEY = 'nexusmd.outputSize'
// Dragged sizes: the height when docked at the bottom, the width at the right.
const LIMITS = { bottom: [96, 900], right: [280, 1100] }
const readSizes = () => { try { return JSON.parse(localStorage.getItem(SIZE_KEY)) ?? {} } catch { return {} } }
const time = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// One output line, keeping git's ANSI colours (mapped onto the theme).
function Line({ text, tone }) {
  return (
    <div className={tone ? `l-${tone}` : undefined}>
      {ansiToSpans(text).map((s, j) => (
        <span key={j} style={{ color: s.color ? ANSI_COLORS[s.color] : undefined, fontWeight: s.bold ? 600 : undefined }}>{s.text}</span>
      ))}
    </div>
  )
}

/**
 * The command dock: wraps GitCommandLine (children) and floats the output above it, so it never moves
 * the page. Compact 200px or expanded; snaps to the bottom or the right (remembered); Output and Activity tabs; sticks to the newest line while the
 * user is at the bottom, otherwise offers "Jump to latest". Minimise (– or Esc) hides it behind an
 * "Output ▴" chip; new runs while minimised count as unread instead of reopening it.
 *
 * lines: [{ text, tone?: 'cmd' | 'ok' | 'warn' | 'bad' | 'muted' }], oldest first; ANSI colours are kept.
 * running: the command still running ({ text: '$ git …' }), shown after the lines until it lands in them.
 * activity: sync.activity (newest first): [{ runId?, at, ok, kind, label, summary, detail }].
 * onRetry(runId): offered under a run with failures.
 * children: the command line, or a function given the "Output ▴" chip to place in its own hint row.
 */
export function OutputConsole({ lines = [], running = null, activity = [], onClear = () => {}, onClearActivity = () => {}, onRetry = null, hint = null, children }) {
  const [open, setOpen] = React.useState(() => lines.length > 0)
  const [minimised, setMinimised] = React.useState(false)
  const [big, setBig] = React.useState(false)
  const [side, setSide] = React.useState(() => { try { return localStorage.getItem(SIDE_KEY) === 'right' ? 'right' : 'bottom' } catch { return 'bottom' } })
  const [tab, setTab] = React.useState('output')
  const [unread, setUnread] = React.useState(0)
  const [atBottom, setAtBottom] = React.useState(true)
  const body = React.useRef(null)
  const stick = React.useRef(true)
  const seen = React.useRef(lines.length)

  const show = () => { setOpen(true); setTab('output'); stick.current = true }
  // New output opens the panel, unless the user minimised it.
  React.useEffect(() => {
    const added = lines.length - seen.current
    seen.current = lines.length
    if (added <= 0) return
    if (minimised) setUnread(n => n + 1)
    else show()
  }, [lines.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // So does a command starting.
  React.useEffect(() => { if (running && !minimised) show() }, [running]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useLayoutEffect(() => {
    if (open && stick.current && body.current) body.current.scrollTop = body.current.scrollHeight
  })

  React.useEffect(() => {
    if (!open) return undefined
    const onKey = e => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return
      minimise()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const [sizes, setSizes] = React.useState(readSizes)
  const size = sizes[side]
  const keepSize = (key, value) => {
    setSizes(cur => {
      const next = { ...cur }
      if (value == null) delete next[key]; else next[key] = value
      try { localStorage.setItem(SIZE_KEY, JSON.stringify(next)) } catch { /* not remembered */ }
      return next
    })
  }
  // The edge facing the page (top at the bottom, left at the right) drags the size; a double-click resets it.
  const grip = e => {
    if (e.button > 0) return
    e.preventDefault()
    const key = side
    const box = e.currentTarget.parentElement.getBoundingClientRect()
    const [lo, hi] = LIMITS[key]
    let last = null
    const move = ev => {
      const raw = key === 'bottom' ? box.bottom - ev.clientY : box.right - ev.clientX
      last = Math.round(Math.min(hi, Math.max(lo, raw)))
      setSizes(cur => ({ ...cur, [key]: last }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (last != null) keepSize(key, last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const nudgeSize = e => {
    const grow = side === 'bottom' ? 'ArrowUp' : 'ArrowLeft'
    const shrink = side === 'bottom' ? 'ArrowDown' : 'ArrowRight'
    if (e.key !== grow && e.key !== shrink) return
    e.preventDefault()
    const [lo, hi] = LIMITS[side]
    const now = size ?? e.currentTarget.parentElement.getBoundingClientRect()[side === 'bottom' ? 'height' : 'width']
    keepSize(side, Math.round(Math.min(hi, Math.max(lo, now + (e.key === grow ? 20 : -20)))))
  }
  const toggleSide = () => {
    const next = side === 'right' ? 'bottom' : 'right'
    setSide(next)
    try { localStorage.setItem(SIDE_KEY, next) } catch { /* not remembered */ }
  }
  const minimise = () => { setOpen(false); setMinimised(true); setUnread(0) }
  const restore = () => { stick.current = true; setAtBottom(true); setOpen(true); setMinimised(false); setUnread(0) }
  const onScroll = e => {
    const el = e.currentTarget
    const b = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
    stick.current = b
    if (b !== atBottom) setAtBottom(b)
  }
  const jump = () => { stick.current = true; setAtBottom(true); if (body.current) body.current.scrollTop = body.current.scrollHeight }
  const entries = [...activity].reverse()
  const copy = () => {
    const text = tab === 'output' ? lines.map(l => stripAnsi(l.text)).join('\n') : entries.map(e => `${time(e.at)} ${e.ok ? '✓' : '✗'} ${e.label} — ${e.summary}\n${e.detail ?? ''}`).join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
  }
  const has = lines.length > 0 || activity.length > 0 || !!running
  // The last entry of each run with a failure carries its Retry failed.
  const retryAt = new Map()
  if (onRetry) entries.forEach((e, i) => { if (e.runId != null && entries.some(x => x.runId === e.runId && !x.ok)) retryAt.set(e.runId, i) })

  const chip = has && !open ? (
    <button className="nx-gw-out-chip" onClick={restore} aria-label={unread ? `Show output, ${unread} new` : 'Show output'}>
      {unread > 0 && <span className="dot" />}{unread ? `Output · ${unread} new ▴` : 'Output ▴'}
    </button>
  ) : null
  const placesChip = typeof children === 'function'
  if (!children && !has && !hint) return null

  return (
    <div className="nx-gw-dock">
      {open && has && (
        <section className="nx-gw-out" data-big={big || undefined} data-side={side} aria-label="Command output" style={size ? { [side === 'bottom' ? 'height' : 'width']: size } : undefined}>
          <div role="separator" aria-orientation={side === 'bottom' ? 'horizontal' : 'vertical'} aria-label="Resize output" tabIndex={0} className="nx-gw-out-grip"
            title="Drag to resize · double-click to reset" onPointerDown={grip} onKeyDown={nudgeSize} onDoubleClick={() => keepSize(side, null)} />
          <div className="nx-gw-out-head" role="tablist">
            <button role="tab" className="nx-gw-out-tab" aria-selected={tab === 'output'} onClick={() => { stick.current = true; setTab('output') }}>Output</button>
            <button role="tab" className="nx-gw-out-tab" aria-selected={tab === 'activity'} onClick={() => { stick.current = true; setTab('activity') }}>{`Activity ${activity.length}`}</button>
            <span style={{ flex: 1 }} />
            <button className="nx-gw-out-tool" onClick={copy}>Copy</button>
            <button className="nx-gw-out-tool" onClick={tab === 'output' ? onClear : onClearActivity}>Clear</button>
            <button className="nx-gw-out-tool" aria-label={side === 'right' ? 'Dock output at the bottom' : 'Dock output at the right'} title={side === 'right' ? 'Snap to the bottom' : 'Snap to the right'} onClick={toggleSide}>{side === 'right' ? '⇩ Bottom' : '⇨ Right'}</button>
            <button className="nx-gw-out-tool" aria-pressed={big} onClick={() => { stick.current = true; keepSize(side, null); setBig(b => !b) }}>{big ? 'Shrink ▾' : 'Expand ▴'}</button>
            <button className="nx-gw-out-tool" aria-label="Minimise output" title="Minimise (Esc)" onClick={minimise}>–</button>
          </div>
          <div ref={body} className="nx-gw-out-body" onScroll={onScroll} tabIndex={0}>
            {tab === 'output' && (lines.length || running
              ? <>
                  {lines.map((l, i) => <Line key={i} text={l.text} tone={l.tone} />)}
                  {running && <><Line text={running.text} tone="cmd" /><div className="l-muted">Working…</div></>}
                </>
              : <div className="nx-gw-out-empty">Run a command below — its output lands here.</div>)}
            {tab === 'activity' && (entries.length
              ? entries.map((e, i) => (
                <React.Fragment key={i}>
                  <div className="nx-gw-act">
                    <span className="at">{time(e.at)}</span>
                    <span style={{ color: e.ok ? 'var(--success)' : 'var(--danger)' }}>{e.ok ? '✓' : '✗'}</span>
                    <span className="msg">{`${e.label} — ${e.summary}`}{e.detail && <span className="detail">{e.detail}</span>}</span>
                  </div>
                  {retryAt.get(e.runId) === i && <button className="btn sm ghost nx-gw-act-retry" onClick={() => onRetry(e.runId)}>Retry failed</button>}
                </React.Fragment>
              ))
              : <div className="nx-gw-out-empty">Actions you take this session (pull, push, commit…) are listed here.</div>)}
          </div>
          {!atBottom && <button className="nx-gw-jump" onClick={jump}>Jump to latest ↓</button>}
        </section>
      )}
      {placesChip ? children(chip) : children}
      {(hint || (!placesChip && chip)) && (
        <div className="nx-gw-dock-hint">
          {!placesChip && chip}
          {hint}
        </div>
      )}
    </div>
  )
}
