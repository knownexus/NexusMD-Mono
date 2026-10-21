import React from 'react'

const STICK_PX = 24
const time = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * The command dock: wraps GitCommandLine (children) and floats the output above it, so it never moves
 * the page. Compact 200px or expanded; Output and Activity tabs; sticks to the newest line while the
 * user is at the bottom, otherwise offers "Jump to latest". Minimise (– or Esc) hides it behind an
 * "Output ▴" chip; new runs while minimised count as unread instead of reopening it.
 *
 * lines: [{ text, tone?: 'cmd' | 'ok' | 'warn' | 'bad' | 'muted' }], oldest first.
 * activity: sync.activity (newest first, as ActivityDrawer uses it): [{ at, ok, kind, label, summary, detail }].
 * Replaces ActivityDrawer.
 */
export function OutputConsole({ lines = [], activity = [], onClear = () => {}, onClearActivity = () => {}, hint = null, children }) {
  const [open, setOpen] = React.useState(() => lines.length > 0)
  const [minimised, setMinimised] = React.useState(false)
  const [big, setBig] = React.useState(false)
  const [tab, setTab] = React.useState('output')
  const [unread, setUnread] = React.useState(0)
  const [atBottom, setAtBottom] = React.useState(true)
  const body = React.useRef(null)
  const stick = React.useRef(true)
  const seen = React.useRef(lines.length)

  // New output opens the panel, unless the user minimised it.
  React.useEffect(() => {
    const added = lines.length - seen.current
    seen.current = lines.length
    if (added <= 0) return
    if (minimised) setUnread(n => n + 1)
    else { setOpen(true); setTab('output'); stick.current = true }
  }, [lines.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const text = tab === 'output' ? lines.map(l => l.text).join('\n') : entries.map(e => `${time(e.at)} ${e.ok ? '✓' : '✗'} ${e.label} — ${e.summary}\n${e.detail ?? ''}`).join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
  }
  const has = lines.length > 0 || activity.length > 0

  return (
    <div className="nx-gw-dock">
      {open && has && (
        <section className="nx-gw-out" data-big={big || undefined} aria-label="Command output">
          <div className="nx-gw-out-head" role="tablist">
            <button role="tab" className="nx-gw-out-tab" aria-selected={tab === 'output'} onClick={() => { stick.current = true; setTab('output') }}>Output</button>
            <button role="tab" className="nx-gw-out-tab" aria-selected={tab === 'activity'} onClick={() => { stick.current = true; setTab('activity') }}>{`Activity ${activity.length}`}</button>
            <span style={{ flex: 1 }} />
            <button className="nx-gw-out-tool" onClick={copy}>Copy</button>
            <button className="nx-gw-out-tool" onClick={tab === 'output' ? onClear : onClearActivity}>Clear</button>
            <button className="nx-gw-out-tool" aria-pressed={big} onClick={() => { stick.current = true; setBig(b => !b) }}>{big ? 'Shrink ▾' : 'Expand ▴'}</button>
            <button className="nx-gw-out-tool" aria-label="Minimise output" title="Minimise (Esc)" onClick={minimise}>–</button>
          </div>
          <div ref={body} className="nx-gw-out-body" onScroll={onScroll} tabIndex={0}>
            {tab === 'output' && (lines.length
              ? lines.map((l, i) => <div key={i} className={l.tone ? `l-${l.tone}` : undefined}>{l.text}</div>)
              : <div className="nx-gw-out-empty">Run a command below — its output lands here.</div>)}
            {tab === 'activity' && (entries.length
              ? entries.map((e, i) => (
                <div key={i} className="nx-gw-act">
                  <span className="at">{time(e.at)}</span>
                  <span style={{ color: e.ok ? 'var(--success)' : 'var(--danger)' }}>{e.ok ? '✓' : '✗'}</span>
                  <span className="msg">{`${e.label} — ${e.summary}`}{e.detail && <span className="detail">{e.detail}</span>}</span>
                </div>
              ))
              : <div className="nx-gw-out-empty">Actions you take this session (pull, push, commit…) are listed here.</div>)}
          </div>
          {!atBottom && <button className="nx-gw-jump" onClick={jump}>Jump to latest ↓</button>}
        </section>
      )}
      {children}
      <div className="nx-gw-dock-hint">
        {has && !open && (
          <button className="nx-gw-out-chip" onClick={restore} aria-label={unread ? `Show output, ${unread} new` : 'Show output'}>
            {unread > 0 && <span className="dot" />}{unread ? `Output · ${unread} new ▴` : 'Output ▴'}
          </button>
        )}
        {hint}
      </div>
    </div>
  )
}
