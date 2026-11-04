import React from 'react'
import { logsAdapter } from './adapters/logs.js'
import { rendererLog } from './shell/renderer-log.js'
import {
  LEVELS, moduleColor, mergeLive, laneLayout, describeTrail, formatTime, formatDuration, formatSize, todayUtc, entryKey,
} from './log-view.js'

const log = rendererLog('core', 'log-viewer')

const LEVEL_STYLE = {
  error: { color: 'var(--danger)',      glyph: '✕' },
  warn:  { color: 'var(--warning)',     glyph: '▲' },
  info:  { color: 'var(--text)',        glyph: '●' },
  debug: { color: 'var(--text-muted)',  glyph: '○' },
}
const DEFAULT_LEVELS = ['error', 'warn', 'info']
const LANE_W = 16
const DOT_Y = 11 // where a lane's dot sits: level with the first line of a row

// Hover and keyboard focus can't be written inline.
const CSS = `
.lv-btn{all:unset;box-sizing:border-box;cursor:pointer;border-radius:6px}
.lv-btn:focus-visible,.lv-row:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.lv-row{all:unset;box-sizing:border-box;display:flex;flex-wrap:wrap;gap:0 10px;align-items:baseline;width:100%;padding:3px 8px;cursor:pointer;font:inherit}
.lv-msg{flex:1 1 260px;min-width:0}
.lv-row:hover{background:var(--surface-hover, rgba(127,127,127,.09))}
.lv-chip{padding:3px 10px;border:1px solid var(--border);display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:var(--text)}
.lv-chip[aria-pressed="true"]{background:var(--surface-2);border-color:var(--text-muted);font-weight:600}
.lv-chip:hover{border-color:var(--text-muted)}
@media (prefers-reduced-motion:no-preference){.lv-live-dot{animation:lv-pulse 1.6s ease-in-out infinite}}
@keyframes lv-pulse{50%{opacity:.35}}
`

const field = {
  padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface-2)', outline: 'none', fontSize: 13, color: 'var(--text)',
}

const Dot = ({ mod, size = 8 }) => (
  <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: moduleColor(mod), flexShrink: 0, display: 'inline-block' }} />
)

// The columns at the left of a row when a call is followed: one per module, a dot in the entry's own.
function Gutter({ lanes, lane, first, last }) {
  return (
    <span aria-hidden style={{ display: 'inline-flex', alignSelf: 'stretch', flexShrink: 0 }}>
      {lanes.map((mod, i) => (
        <span key={mod} style={{ position: 'relative', width: LANE_W }}>
          <span style={{ position: 'absolute', left: LANE_W / 2 - 0.5, width: 1, top: first && i === lane ? DOT_Y : 0, ...(last && i === lane ? { height: DOT_Y } : { bottom: 0 }), background: moduleColor(mod), opacity: 0.45 }} />
          {i === lane && <span style={{ position: 'absolute', left: LANE_W / 2 - 4.5, top: DOT_Y - 4.5, width: 9, height: 9, borderRadius: '50%', background: moduleColor(mod) }} />}
        </span>
      ))}
    </span>
  )
}

// The stack usually starts with "Name: message"; say it once.
const errorText = err => {
  const head = `${err.name}: ${err.message}`
  return err.stack ? (err.stack.startsWith(head) ? err.stack : `${head}\n${err.stack}`) : head
}

function Detail({ e, onFollow, following }) {
  const text = { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11, color: 'var(--text-muted)' }
  return (
    <div style={{ margin: '2px 8px 8px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {e.err && <pre style={{ ...text, color: 'var(--text)' }}>{errorText(e.err)}</pre>}
      {e.data !== undefined && <pre style={text}>{JSON.stringify(e.data, null, 2)}</pre>}
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--font, inherit)' }}>
        {[e.scope && `scope ${e.scope}`, e.proc === 'renderer' && 'from a window', e.rep > 1 && `repeated ${e.rep} times`, e.via?.length && `reached through ${e.via.join(', then ')}`].filter(Boolean).join(' — ') || 'No more detail.'}
      </div>
      {e.cid && !following && (
        <div>
          <button className="btn sm" onClick={() => onFollow(e.cid)}>Follow this call</button>
        </div>
      )}
    </div>
  )
}

export default function LogViewer() {
  const [modules, setModules] = React.useState(null)       // null until loaded
  const [picked, setPicked] = React.useState(() => new Set())
  const [day, setDay] = React.useState(null)
  const [levels, setLevels] = React.useState(() => new Set(DEFAULT_LEVELS))
  const [text, setText] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [result, setResult] = React.useState({ entries: [], truncated: false, skipped: 0 })
  const [loading, setLoading] = React.useState(false)
  const [live, setLive] = React.useState(false)
  const [open, setOpen] = React.useState(null)             // key of the expanded entry
  const [follow, setFollow] = React.useState(null)         // { cid, result } while a call is followed
  const [failure, setFailure] = React.useState(null)

  const listRef = React.useRef(null)
  const stick = React.useRef(true)
  const request = React.useRef(0)
  const filters = React.useRef({})
  filters.current = { mods: picked, levels, text: debounced }

  const loadModules = React.useCallback(async () => {
    try {
      const list = (await logsAdapter.modules()) ?? []
      setModules(list)
      setDay(d => d ?? list.flatMap(m => m.days.map(x => x.date)).sort().at(-1) ?? todayUtc())
    } catch (err) {
      log.error('listing the modules failed', err)
      setFailure('The log folder could not be read.')
      setModules([])
    }
  }, [])
  React.useEffect(() => { loadModules() }, [loadModules])

  React.useEffect(() => { const t = setTimeout(() => setDebounced(text), 250); return () => clearTimeout(t) }, [text])

  const days = React.useMemo(() => {
    const all = new Set((modules ?? []).flatMap(m => m.days.map(d => d.date)))
    all.add(todayUtc())
    return [...all].sort().reverse()
  }, [modules])
  const dayBytes = React.useMemo(() => (modules ?? []).reduce((n, m) => n + (m.days.find(d => d.date === day)?.size ?? 0), 0), [modules, day])

  const runQuery = React.useCallback(async () => {
    if (!day) return
    const id = ++request.current
    setLoading(true)
    try {
      const r = await logsAdapter.query({ date: day, mods: [...picked], levels: [...levels], text: debounced })
      if (id === request.current && r) { setResult(r); setFailure(null) }
    } catch (err) {
      log.error('querying the logs failed', err, { day })
      if (id === request.current) setFailure('The logs could not be read.')
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [day, picked, levels, debounced])
  React.useEffect(() => { if (!follow) runQuery() }, [runQuery, follow])

  // Live: show today, then add new entries as they arrive.
  React.useEffect(() => {
    if (!live || follow) return undefined
    let stop = () => {}
    let cancelled = false
    logsAdapter.tail(batch => setResult(r => ({ ...r, entries: mergeLive(r.entries, batch, filters.current) })))
      .then(s => { if (cancelled) s(); else stop = s })
      .catch(err => { log.error('starting the live tail failed', err); setLive(false) })
    return () => { cancelled = true; stop() }
  }, [live, follow])
  React.useEffect(() => { if (live) setDay(todayUtc()) }, [live])

  // Stay at the newest entry unless the reader has scrolled up.
  const shown = follow ? follow.result.entries : result.entries
  React.useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [shown])
  const onScroll = () => {
    const el = listRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const toggle = (set, setter, v) => setter(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n })

  const startFollow = async (cid) => {
    setLive(false)
    try {
      const r = await logsAdapter.follow(cid)
      stick.current = false
      setFollow({ cid, result: r ?? { entries: [], modules: [], truncated: false, skipped: 0 } })
      setOpen(null)
    } catch (err) {
      log.error('following a call failed', err, { cid })
      setFailure('That call could not be loaded.')
    }
  }

  if (!logsAdapter.available()) {
    return <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>Logs are only available in the desktop app.</div>
  }
  if (modules && !modules.length && !failure) {
    return <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>No logs yet. Entries appear here as soon as the app or one of its modules logs something.</div>
  }

  const entries = shown
  const layout = follow ? laneLayout(entries) : null
  const trail = follow ? describeTrail(entries) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '8px 16px 16px' }}>
      <style>{CSS}</style>

      {follow ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={() => { setFollow(null); stick.current = true }}>Back to the day's log</button>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Following one call: {trail.hops.length} {trail.hops.length === 1 ? 'module' : 'modules'}, {entries.length} {entries.length === 1 ? 'entry' : 'entries'}, {formatDuration(trail.ms)}
            </span>
          </div>
          <ol aria-label="Modules this call passed through" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, listStyle: 'none', margin: 0, padding: 0 }}>
            {trail.hops.map((h, i) => (
              <li key={h.mod} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <span aria-hidden style={{ color: 'var(--text-subtle)' }}>→</span>}
                <span className="lv-chip" style={{ borderRadius: 999, borderColor: h.mod === trail.failedIn ? 'var(--danger)' : undefined }}>
                  <Dot mod={h.mod} />
                  {h.mod}
                  <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                    {h.count}{h.errors ? `, ${h.errors} failed` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Modules" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button className="lv-btn lv-chip" style={{ borderRadius: 999 }} aria-pressed={picked.size === 0} onClick={() => setPicked(new Set())}>All modules</button>
            {(modules ?? []).map(m => (
              <button key={m.mod} className="lv-btn lv-chip" style={{ borderRadius: 999 }} aria-pressed={picked.has(m.mod)} onClick={() => toggle(picked, setPicked, m.mod)}>
                <Dot mod={m.mod} />{m.mod}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <select aria-label="Day" title="Days run midnight to midnight UTC" value={day ?? ''} disabled={live} onChange={e => setDay(e.target.value)} style={field}>
              {days.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <div role="group" aria-label="Levels" style={{ display: 'flex', gap: 4 }}>
              {LEVELS.map(l => (
                <button key={l} className="lv-btn lv-chip" aria-pressed={levels.has(l)} onClick={() => toggle(levels, setLevels, l)}
                  style={{ color: LEVEL_STYLE[l].color }}>
                  <span aria-hidden>{LEVEL_STYLE[l].glyph}</span>{l}
                </button>
              ))}
            </div>
            <input aria-label="Search logs" type="search" value={text} placeholder="Search logs" onChange={e => setText(e.target.value)} style={{ ...field, flex: 1, minWidth: 160 }} />
            <button className="btn sm" aria-pressed={live} onClick={() => setLive(v => !v)} style={live ? { borderColor: 'var(--accent)' } : undefined}>
              {live && <span className="lv-live-dot" aria-hidden style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', marginRight: 6 }} />}
              {live ? 'Live' : 'Go live'}
            </button>
            <button className="btn sm ghost" onClick={() => { loadModules(); runQuery() }} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </>
      )}

      {failure && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5 }}>{failure}</div>}

      <div aria-live="polite" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
        {follow
          ? (follow.result.truncated ? 'This call logged more than can be shown; the newest entries are listed.' : '')
          : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${dayBytes ? ` on ${day} (${formatSize(dayBytes)} of logs)` : ''}${result.truncated ? '. Only the newest are shown; narrow the filters to see earlier ones.' : ''}${result.skipped ? `. ${result.skipped} damaged ${result.skipped === 1 ? 'line was' : 'lines were'} skipped.` : ''}${entries.length ? '. Select an entry for details or to follow its call.' : ''}`}
      </div>

      <ul ref={listRef} onScroll={onScroll} aria-label="Log entries"
        style={{ listStyle: 'none', margin: 0, padding: '4px 0', height: 'clamp(280px, 55vh, 560px)', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.55 }}>
        {entries.length === 0 && (
          <li style={{ padding: 12, color: 'var(--text-muted)', fontFamily: 'inherit' }}>
            {loading ? 'Loading…' : follow ? 'No entries were found for this call.' : 'Nothing matches. Clear the search, pick more modules or turn on more levels.'}
          </li>
        )}
        {(follow ? layout.rows : entries.map(entry => ({ entry }))).map(({ entry: e, lane }, i, rows) => {
          const key = entryKey(e)
          const isOpen = open === key
          const ls = LEVEL_STYLE[e.lvl] ?? LEVEL_STYLE.info
          return (
            <li key={key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <button className="lv-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                {follow && <Gutter lanes={layout.lanes} lane={lane} first={i === 0} last={i === rows.length - 1} />}
                <span style={{ color: 'var(--text-subtle)', flexShrink: 0 }}>{formatTime(e.ts)}</span>
                <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center', width: 96, flexShrink: 0 }}>
                  {!follow && <Dot mod={e.mod} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.mod}</span>
                </span>
                <span style={{ color: ls.color, width: 56, flexShrink: 0 }}><span aria-hidden>{ls.glyph} </span>{e.lvl}</span>
                <span className="lv-msg" style={{ color: e.lvl === 'error' || e.lvl === 'warn' ? ls.color : 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {e.scope && <span style={{ color: 'var(--accent)' }}>[{e.scope}] </span>}
                  {e.msg}
                  {e.err && !isOpen && <span style={{ color: 'var(--text-muted)' }}> — {e.err.message}</span>}
                  {!follow && e.via?.length > 0 && <span style={{ color: 'var(--text-muted)' }}> (from {e.via.at(-1)})</span>}
                </span>
              </button>
              {isOpen && <Detail e={e} following={!!follow} onFollow={startFollow} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
