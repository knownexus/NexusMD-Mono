import React from 'react'
import { logsAdapter } from './adapters/logs.js'
import { rendererLog } from '@nexusmd/core'
import {
  LEVELS, moduleColor, mergeLive, laneLayout, laneSpans, describeTrail, messageParts, offsetLabel, routeOf,
  formatTime, formatDuration, formatSize, todayUtc, entryKey,
} from './log-view.js'

const log = rendererLog('core', 'log-viewer')

// Colour carries the level, and a word backs it up for anyone who cannot see the colour.
const LEVEL_STYLE = {
  error: { color: 'var(--danger)',     glyph: '✕' },
  warn:  { color: 'var(--warning)',    glyph: '▲' },
  info:  { color: 'var(--text-muted)', glyph: '●' },
  debug: { color: 'var(--text-subtle)', glyph: '○' },
}
const DEFAULT_LEVELS = ['error', 'warn', 'info']
const LANE_W = 18
const DOT_Y = 12 // where a lane's dot sits: level with the first line of a row

// Hover, focus and motion can't be written inline. Motion only answers an action: following a call, going back,
// focusing a module. Nothing moves on its own except the live dot.
const CSS = `
.lv{display:flex;flex-direction:column;gap:12px;padding:8px 16px 16px;min-width:0}
.lv button{font:inherit}
.lv-btn{all:unset;box-sizing:border-box;cursor:pointer}
.lv-btn:focus-visible,.lv-row:focus-visible,.lv-route:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.lv-chip{padding:3px 11px;border:1px solid var(--border);border-radius:999px;display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:var(--text);line-height:1.5}
.lv-chip:hover{border-color:var(--text-muted)}
.lv-chip[aria-pressed="true"]{font-weight:600;border-color:var(--c,var(--text-muted));background:color-mix(in oklch,var(--c,var(--text-muted)) 15%,var(--surface-2))}
.lv-lvl{border-radius:6px;gap:5px}
.lv-lvl[aria-pressed="true"]{border-color:currentColor;background:color-mix(in oklch,currentColor 12%,var(--surface-2))}
.lv-lvl[aria-pressed="false"]{opacity:.6}
.lv-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lv-sum{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;justify-content:space-between}
.lv-list{list-style:none;margin:0;padding:0;height:clamp(300px,58vh,600px);overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);overscroll-behavior:contain}
.lv-list[data-call]{height:auto;max-height:clamp(300px,58vh,600px)}
.lv-li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;border-bottom:1px solid var(--border-subtle);border-left:3px solid transparent;position:relative}
.lv-li:last-child{border-bottom:0}
.lv-li[data-lvl="error"]{border-left-color:var(--danger);background:color-mix(in oklch,var(--danger) 6%,transparent)}
.lv-li[data-lvl="warn"]{border-left-color:var(--warning)}
.lv-li[data-dim]{opacity:.36}
.lv-row{all:unset;box-sizing:border-box;display:flex;gap:0 10px;align-items:baseline;min-width:0;padding:5px 6px 5px 8px;cursor:pointer;font:inherit}
.lv-row:hover,.lv-li:hover{background:var(--surface-hover,rgba(127,127,127,.08))}
.lv-time{flex:0 0 auto;min-width:78px;color:var(--text-subtle);font:11px/1.6 var(--mono,monospace);font-variant-numeric:tabular-nums}
.lv-glyph{flex:0 0 12px;text-align:center;font-size:9.5px}
.lv-mod{flex:0 0 84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;display:inline-flex;gap:6px;align-items:center}
.lv-text{flex:1 1 auto;min-width:0;font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.lv-scope{color:var(--text-subtle);font:11px var(--mono,monospace);margin-right:7px}
.lv-more{color:var(--text-subtle);font-size:11.5px;margin-left:8px}
.lv-route{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:0;padding:5px 10px 5px 6px;margin-top:1px;border-radius:999px}
.lv-route:hover{background:color-mix(in oklch,var(--text-muted) 14%,transparent)}
.lv-hop{width:8px;height:8px;border-radius:50%;flex:none}
.lv-link{width:7px;height:1.5px;background:var(--text-subtle);opacity:.6;flex:none}
.lv-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.lv-detail{grid-column:1/-1;margin:0 8px 9px 30px;display:flex;flex-direction:column;gap:7px;min-width:0}
.lv-detail pre{margin:0;padding:8px 10px;border-radius:6px;background:color-mix(in oklch,var(--text) 5%,transparent);white-space:pre-wrap;word-break:break-word;font:11px/1.55 var(--mono,monospace);color:var(--text-muted)}
.lv-trail{display:flex;flex-wrap:wrap;align-items:center;gap:0;list-style:none;margin:0;padding:0}
.lv-trail li{display:inline-flex;align-items:center}
.lv-trail .lv-link{width:18px;margin:0 2px}
.lv-hopchip{padding:4px 12px 4px 10px}
.lv-hopchip[data-failed]{border-color:var(--danger)}
@media (prefers-reduced-motion:no-preference){
  .lv-live-dot{animation:lv-pulse 1.6s ease-in-out infinite}
  .lv-li{transition:opacity .18s ease}
  .lv-chip,.lv-lvl{transition:background-color .15s ease,border-color .15s ease,opacity .15s ease}
  .lv-enter{animation:lv-enter .2s ease-out}
  .lv-li[data-from]{animation:lv-from 1.6s ease-out}
}
@keyframes lv-pulse{50%{opacity:.35}}
@keyframes lv-enter{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes lv-from{0%,35%{background:color-mix(in oklch,var(--accent) 24%,transparent)}100%{background:transparent}}
`

const field = {
  padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface-2)', outline: 'none', fontSize: 13, color: 'var(--text)',
}

const Dot = ({ mod, size = 8 }) => (
  <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: moduleColor(mod), flexShrink: 0, display: 'inline-block' }} />
)

// The columns at the left of a row when a call is followed: one lane per module, drawn only from where the call
// first reaches it to where it last leaves it, with a short bridge where the call moves from one lane to the next.
function Gutter({ lanes, spans, index, lane, prevLane }) {
  const x = (i) => i * LANE_W + LANE_W / 2
  return (
    <span aria-hidden style={{ position: 'relative', alignSelf: 'stretch', flex: `0 0 ${lanes.length * LANE_W}px` }}>
      {lanes.map((mod, i) => {
        const { first: from, last: to } = spans[i]
        if (index < from || index > to) return null
        const top = index === from ? DOT_Y : 0
        const bottom = index === to ? DOT_Y : 0
        return <span key={mod} style={{ position: 'absolute', left: x(i) - 0.5, width: 1, top, bottom, background: moduleColor(mod), opacity: 0.45 }} />
      })}
      {prevLane != null && prevLane !== lane && (
        <span style={{ position: 'absolute', top: DOT_Y - 0.75, height: 1.5, left: x(Math.min(lane, prevLane)), width: Math.abs(lane - prevLane) * LANE_W, background: moduleColor(lanes[lane]), opacity: 0.8 }} />
      )}
      <span style={{ position: 'absolute', left: x(lane) - 4.5, top: DOT_Y - 4.5, width: 9, height: 9, borderRadius: '50%', background: moduleColor(lanes[lane]), boxShadow: '0 0 0 2px var(--surface-2)' }} />
    </span>
  )
}

// The stack usually starts with "Name: message"; say it once.
const errorText = err => {
  const head = `${err.name}: ${err.message}`
  return err.stack ? (err.stack.startsWith(head) ? err.stack : `${head}\n${err.stack}`) : head
}

function Detail({ e, onFollow, following, more }) {
  const meta = [e.scope && `scope ${e.scope}`, e.proc === 'renderer' && 'from a window', e.rep > 1 && `repeated ${e.rep} times`, e.via?.length && `reached through ${e.via.join(', then ')}`].filter(Boolean).join(' — ')
  return (
    <div className="lv-detail">
      {more > 0 && <pre style={{ color: 'var(--text)' }}>{String(e.msg).replace(/%c/g, '')}</pre>}
      {e.err && <pre style={{ color: 'var(--text)' }}>{errorText(e.err)}</pre>}
      {e.data !== undefined && <pre>{JSON.stringify(e.data, null, 2)}</pre>}
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{meta || 'No more detail.'}</div>
      {e.cid && !following && (
        <div>
          <button className="btn sm" onClick={() => onFollow(e)}>Follow this call</button>
        </div>
      )}
    </div>
  )
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
  const [focusMod, setFocusMod] = React.useState(null)     // a module of the followed call the rest steps back from
  const [from, setFrom] = React.useState(null)             // key of the entry a followed call was started from
  const [failure, setFailure] = React.useState(null)

  const listRef = React.useRef(null)
  const stick = React.useRef(true)
  const returnTo = React.useRef(null)                      // where the day's list was scrolled to when a call was followed
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

  // Changing between the day and one call keeps the reader's place: a followed call opens on its first failure,
  // and going back returns to where the day's list was, with the entry it came from lit for a moment.
  React.useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (follow) {
      el.querySelector('[data-first-error]')?.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    } else if (returnTo.current != null) {
      el.scrollTop = returnTo.current
      returnTo.current = null
    }
  }, [follow])
  React.useEffect(() => {
    if (!from || follow) return undefined
    const t = setTimeout(() => setFrom(null), 2000)
    return () => clearTimeout(t)
  }, [from, follow])

  const toggle = (setter, v) => setter(prev => { const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n })

  const startFollow = async (entry) => {
    setLive(false)
    try {
      const r = await logsAdapter.follow(entry.cid)
      returnTo.current = listRef.current?.scrollTop ?? null
      stick.current = false
      setFrom(entryKey(entry))
      setFocusMod(null)
      setFollow({ cid: entry.cid, result: r ?? { entries: [], modules: [], truncated: false, skipped: 0 } })
      setOpen(null)
    } catch (err) {
      log.error('following a call failed', err, { cid: entry.cid })
      setFailure('That call could not be loaded.')
    }
  }
  const goBack = () => { setFollow(null); setFocusMod(null); stick.current = false }

  if (!logsAdapter.available()) {
    return <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>Logs are only available in the desktop app.</div>
  }
  if (modules && !modules.length && !failure) {
    return <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>No logs yet. Entries appear here as soon as the app or one of its modules logs something.</div>
  }

  const entries = shown
  const layout = follow ? laneLayout(entries) : null
  const spans = layout ? laneSpans(layout.rows, layout.lanes.length) : null
  const trail = follow ? describeTrail(entries) : null
  const firstError = follow ? entries.findIndex(x => x.lvl === 'error') : -1

  return (
    <div className="lv">
      <style>{CSS}</style>

      {follow ? (
        <div className="lv-enter" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={goBack}>Back to the day's log</button>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Following one call: {trail.hops.length} {trail.hops.length === 1 ? 'module' : 'modules'}, {entries.length} {entries.length === 1 ? 'entry' : 'entries'}, {formatDuration(trail.ms)}
            </span>
          </div>
          <ol aria-label="Modules this call passed through" className="lv-trail">
            {trail.hops.map((h, i) => (
              <li key={h.mod}>
                {i > 0 && <span aria-hidden className="lv-link" />}
                <button className="lv-btn lv-chip lv-hopchip" style={{ '--c': moduleColor(h.mod) }} data-failed={h.mod === trail.failedIn ? '' : undefined}
                  aria-pressed={focusMod === h.mod} title={focusMod === h.mod ? 'Show every module again' : `Focus on ${h.mod}`}
                  onClick={() => setFocusMod(f => (f === h.mod ? null : h.mod))}>
                  <Dot mod={h.mod} />
                  {h.mod}
                  <span style={{ color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 400 }}>
                    {h.count}{h.errors ? `, ${h.errors} failed` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Modules" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button className="lv-btn lv-chip" aria-pressed={picked.size === 0} onClick={() => setPicked(new Set())}>All modules</button>
            {(modules ?? []).map(m => (
              <button key={m.mod} className="lv-btn lv-chip" style={{ '--c': moduleColor(m.mod) }} aria-pressed={picked.has(m.mod)} onClick={() => toggle(setPicked, m.mod)}>
                <Dot mod={m.mod} />{m.mod}
              </button>
            ))}
          </div>

          <div className="lv-tools">
            <input aria-label="Search logs" type="search" value={text} placeholder="Search logs" onChange={e => setText(e.target.value)} style={{ ...field, flex: '1 1 220px', minWidth: 160 }} />
            <select aria-label="Day" title="Days run midnight to midnight UTC" value={day ?? ''} disabled={live} onChange={e => setDay(e.target.value)} style={field}>
              {days.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <button className="btn sm" aria-pressed={live} onClick={() => setLive(v => !v)} style={live ? { borderColor: 'var(--accent)' } : undefined}>
              {live && <span className="lv-live-dot" aria-hidden style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', marginRight: 6 }} />}
              {live ? 'Live' : 'Go live'}
            </button>
            <button className="btn sm ghost" onClick={() => { loadModules(); runQuery() }} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </>
      )}

      {failure && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5 }}>{failure}</div>}

      <div className="lv-sum">
        {!follow && (
          <div role="group" aria-label="Levels" style={{ display: 'flex', gap: 4 }}>
            {LEVELS.map(l => (
              <button key={l} className="lv-btn lv-chip lv-lvl" aria-pressed={levels.has(l)} onClick={() => toggle(setLevels, l)} style={{ color: LEVEL_STYLE[l].color }}>
                <span aria-hidden style={{ fontSize: 9.5 }}>{LEVEL_STYLE[l].glyph}</span><span style={{ color: 'var(--text)' }}>{l}</span>
              </button>
            ))}
          </div>
        )}
        <div aria-live="polite" title={entries.length ? 'Select an entry for details. Follow its call from the dots at the right of the row.' : undefined} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {follow
            ? (follow.result.truncated ? 'This call logged more than can be shown; the newest entries are listed.' : '')
            : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${dayBytes ? ` on ${day} (${formatSize(dayBytes)} of logs)` : ''}${result.truncated ? '. Only the newest are shown; narrow the filters to see earlier ones.' : ''}${result.skipped ? `. ${result.skipped} damaged ${result.skipped === 1 ? 'line was' : 'lines were'} skipped.` : ''}`}
        </div>
      </div>

      <ul key={follow ? 'call' : 'day'} ref={listRef} onScroll={onScroll} aria-label="Log entries" className={`lv-list${follow ? ' lv-enter' : ''}`} data-call={follow ? '' : undefined}>
        {entries.length === 0 && (
          <li style={{ padding: 14, color: 'var(--text-muted)', fontSize: 13 }}>
            {loading ? 'Loading…' : follow ? 'No entries were found for this call.' : 'Nothing matches. Clear the search, pick more modules or turn on more levels.'}
          </li>
        )}
        {(follow ? layout.rows : entries.map(entry => ({ entry }))).map(({ entry: e, lane }, i, rows) => {
          const key = entryKey(e)
          const isOpen = open === key
          const ls = LEVEL_STYLE[e.lvl] ?? LEVEL_STYLE.info
          const { first, more } = messageParts(e.msg)
          const route = routeOf(e)
          return (
            <li key={key} className="lv-li" data-lvl={e.lvl} data-key={key}
              data-dim={follow && focusMod && e.mod !== focusMod ? 'true' : undefined}
              data-from={!follow && from === key ? 'true' : undefined}
              data-first-error={follow && i === firstError ? '' : undefined}>
              <button className="lv-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>
                {follow && <Gutter lanes={layout.lanes} spans={spans} index={i} lane={lane} prevLane={i > 0 ? rows[i - 1].lane : null} />}
                <span className="lv-time" title={follow ? formatTime(e.ts) : undefined}>{follow ? offsetLabel(e.ts, entries[0].ts) : formatTime(e.ts)}</span>
                <span className="lv-glyph" aria-hidden style={{ color: ls.color }}>{ls.glyph}</span>
                <span className="lv-mod" style={{ color: follow ? moduleColor(e.mod) : 'var(--text)' }}>
                  {!follow && <Dot mod={e.mod} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.mod}</span>
                </span>
                <span className="lv-text" style={{ color: e.lvl === 'error' ? 'var(--danger)' : 'var(--text)' }}>
                  <span className="lv-sr">{e.lvl}: </span>
                  {e.scope && <span className="lv-scope">{e.scope}</span>}
                  {first}
                  {more > 0 && <span className="lv-more">+{more} {more === 1 ? 'line' : 'lines'}</span>}
                  {e.err && !isOpen && <span style={{ color: 'var(--text-muted)' }}> — {e.err.message}</span>}
                </span>
              </button>
              {e.cid && !follow ? (
                <button className="lv-route" onClick={() => startFollow(e)}
                  aria-label={`Follow this call: ${route.join(', then ')}`} title={`Follow this call: ${route.join(' → ')}`}>
                  {route.map((m, j) => (
                    <React.Fragment key={m + j}>
                      {j > 0 && <span aria-hidden className="lv-link" />}
                      <span aria-hidden className="lv-hop" style={{ background: moduleColor(m) }} />
                    </React.Fragment>
                  ))}
                </button>
              ) : <span />}
              {isOpen && <Detail e={e} more={more} following={!!follow} onFollow={startFollow} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
