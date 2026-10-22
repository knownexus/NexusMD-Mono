import React from 'react'
import { createPortal } from 'react-dom'
import { ansiToSpans, stripAnsi } from '@nexusmd/core'
import { Icon } from '@nexusmd/ui'
import { usePopoutWindow } from './popout-window.js'

// ansiToSpans colour names on the theme; the git command dock uses them too.
export const ANSI_COLORS = {
  red: 'var(--danger)', green: 'var(--success)', yellow: 'var(--warning)', blue: 'var(--info)',
  cyan: 'var(--info)', magenta: 'var(--violet)', gray: 'var(--text-muted)', white: 'var(--text)', black: 'var(--text)',
}
const BADGE = {
  starting: ['info', 'Starting…'], running: ['info', 'Running'], done: ['ok', 'Finished'],
  cancelled: ['', 'Cancelled'], failed: ['bad', 'Failed'],
}

// Width and expanded state are a per-person convenience, shared by every drawer.
const PREFS_KEY = 'nexusmd.runDrawer'
const MIN_W = 320
const DEFAULT_W = 480
function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    return { width: Number.isFinite(p.width) ? Math.max(MIN_W, p.width) : DEFAULT_W, expanded: p.expanded === true }
  } catch { return { width: DEFAULT_W, expanded: false } }
}
function writePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* private window: keep it in memory */ } }

/**
 * The output of a run. Mount inside a .nx-shell, beside the .nx-page: docked it takes a
 * column the page reflows around (drag its edge to resize), expanded it covers the shell,
 * and popped out it renders into its own window, leaving a small bar behind.
 * lines: [{ text, stream?: 'stderr', tone?: 'muted'|'ok'|'warn'|'bad'|'cmd' }] — ANSI in text is rendered.
 */
export function RunDrawer({ title, eyebrow = 'Output', status, lines = [], step = null, error = null, cancelling = false, exitCode = null, onClose, onCancel, onRetry }) {
  const [prefs, setPrefs] = React.useState(readPrefs)
  const [dragWidth, setDragWidth] = React.useState(null)
  const [popError, setPopError] = React.useState(null)
  const popout = usePopoutWindow({ title: `${title} (NexusMD)`, onClosed: () => {} })
  const self = React.useRef(null)
  const running = status === 'starting' || status === 'running'
  const [tone, label] = BADGE[status] || ['', status || '']
  const badge = status === 'running' && cancelling ? 'Cancelling…' : status === 'failed' && exitCode != null ? `Failed (exit ${exitCode})` : label
  const popped = !!popout.root
  const mode = popped ? 'window' : prefs.expanded ? 'expanded' : 'docked'
  const width = dragWidth ?? prefs.width

  const update = patch => setPrefs(p => { const next = { ...p, ...patch }; writePrefs(next); return next })
  const maxWidth = () => {
    const shell = self.current?.parentElement
    const w = shell?.getBoundingClientRect().width
    // Matches the CSS cap: the page keeps at least 560px beside the drawer.
    return w ? Math.max(MIN_W, w - 560) : Infinity
  }
  const clampW = w => Math.round(Math.min(maxWidth(), Math.max(MIN_W, w)))
  const drag = e => {
    e.preventDefault()
    const right = self.current.getBoundingClientRect().right
    let last = null
    document.body.classList.add('resizing-drawer')
    const move = ev => { last = clampW(right - ev.clientX); setDragWidth(last) }
    const up = () => {
      document.body.classList.remove('resizing-drawer')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragWidth(null)
      if (last != null) update({ width: last })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const nudge = e => {
    const step = e.shiftKey ? 80 : 24
    if (e.key === 'ArrowLeft') { e.preventDefault(); update({ width: clampW(prefs.width + step) }) }
    if (e.key === 'ArrowRight') { e.preventDefault(); update({ width: clampW(prefs.width - step) }) }
  }
  const popOut = () => { setPopError(popout.open() ? null : "Couldn't open a separate window, so the output stays here.") }
  const close = () => { popout.close(); onClose() }

  const panel = (
    <aside ref={popped ? undefined : self} className="nx-drawer" data-mode={mode} role="dialog" aria-label={title}
      style={mode === 'docked' ? { '--nx-drawer-w': `${width}px` } : undefined}>
      {mode === 'docked' && (
        <div className="nx-drawer-grip" role="separator" aria-orientation="vertical" aria-label="Resize output" tabIndex={0}
          aria-valuenow={width} aria-valuemin={MIN_W} onPointerDown={drag} onKeyDown={nudge} onDoubleClick={() => update({ expanded: true })} />
      )}
      <div className="nx-drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nx-eyebrow">{eyebrow}</div>
          <div className="nx-drawer-title nx-trunc" title={title}>{title}</div>
        </div>
        <span className={`nx-badge ${tone}`}>{badge}</span>
        {running && onCancel && <button className="btn sm danger" onClick={onCancel} disabled={cancelling}>Cancel</button>}
        <div className="nx-drawer-tools">
          <CopyButton lines={lines} />
          {!popped && (
            <button className="nx-icon-btn" aria-label={prefs.expanded ? 'Restore size' : 'Expand'} title={prefs.expanded ? 'Restore size' : 'Expand'}
              aria-pressed={prefs.expanded} onClick={() => update({ expanded: !prefs.expanded })}>
              <Icon name={prefs.expanded ? 'collapse' : 'expand'} size={14} />
            </button>
          )}
          <button className="nx-icon-btn" aria-label={popped ? 'Back to the app window' : 'Pop out'} title={popped ? 'Back to the app window' : 'Pop out into its own window'}
            onClick={popped ? popout.close : popOut}>
            <Icon name={popped ? 'dock' : 'popout'} size={14} />
          </button>
          <button className="nx-icon-btn" aria-label="Close" title="Close" onClick={close}><Icon name="x" size={14} /></button>
        </div>
      </div>
      {step && running && (
        <div className="nx-drawer-progress" role="progressbar" aria-label="Progress" aria-valuenow={step.n} aria-valuemax={step.total}>
          <div style={{ width: `${Math.min(100, (step.n / Math.max(1, step.total)) * 100)}%` }} />
        </div>
      )}
      {popError && <div className="nx-alert" role="alert" style={{ borderRadius: 0 }}>{popError}</div>}
      <Output lines={lines} step={step} running={running} error={error} />
      {status === 'failed' && onRetry && (
        <div className="nx-drawer-foot"><button className="btn sm" onClick={onRetry}>Run again</button></div>
      )}
    </aside>
  )

  if (!popped) return panel
  return (
    <>
      {createPortal(panel, popout.root)}
      <div className="nx-drawer-stub" role="status" aria-label={`${title}, in its own window`}>
        <span className={`nx-dot`} data-state={running ? 'running' : status === 'failed' ? 'failed' : undefined} />
        <span className="nx-trunc" style={{ minWidth: 0 }}>{`${title}: ${badge}`}</span>
        <button className="nx-link" onClick={popout.close}>Show here</button>
      </div>
    </>
  )
}

function CopyButton({ lines }) {
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => { if (!copied) return undefined; const t = setTimeout(() => setCopied(false), 1500); return () => clearTimeout(t) }, [copied])
  const copy = () => navigator.clipboard?.writeText(lines.map(l => stripAnsi(l.text)).join('\n')).then(() => setCopied(true), () => {})
  return (
    <button className="nx-icon-btn" aria-label="Copy output" title={copied ? 'Copied' : 'Copy output'} onClick={copy} disabled={!lines.length}>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  )
}

// Follows new lines while scrolled to the bottom; scrolling up to read stops that until you return.
function Output({ lines, step, running, error }) {
  const out = React.useRef(null)
  const follow = React.useRef(true)
  React.useEffect(() => { const el = out.current; if (el && follow.current) el.scrollTop = el.scrollHeight }, [lines])
  const onScroll = () => { const el = out.current; follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24 }
  return (
    <pre ref={out} className="nx-drawer-out" onScroll={onScroll} tabIndex={0} aria-label="Output">
      {step && running && <div className="t-muted">{`Step ${step.n} of ${step.total}: ${step.text}`}</div>}
      {lines.map((l, i) => (
        <div key={i} className={l.tone ? `t-${l.tone}` : l.stream === 'stderr' ? 't-bad' : undefined}>
          {ansiToSpans(l.text).map((s, j) => (
            <span key={j} style={{ color: s.color ? ANSI_COLORS[s.color] : undefined, fontWeight: s.bold ? 600 : undefined }}>{s.text}</span>
          ))}
        </div>
      ))}
      {error && <div className="t-bad">{error}</div>}
      {running && <div className="t-muted">Working…</div>}
    </pre>
  )
}
