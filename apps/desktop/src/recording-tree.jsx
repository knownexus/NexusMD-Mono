import React from 'react'
import { buildTree, searchTree, firstError, offsetLabel, durationLabel } from './recording-model.js'

// What a recording looks like once it is open: the person's actions at the top; under each, in order, what it set off. Select
// anything to see what it was given and what came back, and where in the code it is. Built from recording-model.js.

const SHOW_FIRST = 300 // children shown before "Show N more"
const KIND = { click: 'click', call: 'call', action: 'action', ipc: 'main', net: 'request', log: 'log' }

const CSS = `
.rt{display:flex;flex-direction:column;gap:10px;min-width:0}
.rt-head{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
.rt-head h3{margin:0;font-size:14px}
.rt-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-left:auto}
.rt-field{padding:6px 9px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);font-size:13px;color:var(--text);min-width:180px}
.rt-banner{padding:8px 12px;border-radius:6px;border:1px solid var(--warning);background:color-mix(in oklch,var(--warning) 10%,transparent);font-size:12.5px}
.rt-note{margin:0;font-size:12px;color:var(--text-muted)}
.rt-body{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:12px;align-items:start}
@media (max-width:900px){.rt-body{grid-template-columns:minmax(0,1fr)}}
.rt-tree{height:clamp(320px,60vh,640px);overflow:auto;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);padding:4px 0;outline:none}
.rt-tree:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.rt-row{display:flex;align-items:baseline;gap:8px;padding:3px 8px 3px 4px;cursor:pointer;border-left:3px solid transparent;font-size:13px;line-height:1.5}
.rt-row:hover{background:var(--surface-hover,rgba(127,127,127,.08))}
.rt-row[aria-selected="true"]{background:color-mix(in oklch,var(--accent) 14%,transparent)}
.rt-row[data-failed]{border-left-color:var(--danger)}
.rt-row[data-failed] .rt-title{color:var(--danger)}
.rt-twist{all:unset;box-sizing:border-box;width:16px;text-align:center;cursor:pointer;color:var(--text-muted);font-size:11px;flex:none}
.rt-twist:focus-visible{outline:2px solid var(--accent)}
.rt-gap{width:16px;flex:none}
.rt-time{flex:none;min-width:70px;color:var(--text-subtle);font:11px/1.6 var(--mono,monospace);font-variant-numeric:tabular-nums}
.rt-kind{flex:none;min-width:52px;font-size:11px;color:var(--text-subtle)}
.rt-kind[data-kind="click"]{color:var(--accent);font-weight:600}
.rt-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-ms{flex:none;color:var(--text-muted);font:11px/1.6 var(--mono,monospace)}
.rt-more{padding:4px 8px}
.rt-detail{border:1px solid var(--border);border-radius:8px;background:var(--surface-2);padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-width:0;max-height:clamp(320px,60vh,640px);overflow:auto}
.rt-detail h3{margin:0;font-size:14px;overflow-wrap:anywhere}
.rt-detail h4{margin:6px 0 2px;font-size:12px;color:var(--text-muted);font-weight:600}
.rt-detail p{margin:0;font-size:12.5px;color:var(--text-muted)}
.rt-detail pre{margin:0;padding:8px 10px;border-radius:6px;background:color-mix(in oklch,var(--text) 5%,transparent);white-space:pre-wrap;word-break:break-word;font:11px/1.55 var(--mono,monospace);color:var(--text)}
.rt-empty{padding:14px;color:var(--text-muted);font-size:13px}
`

const json = (v) => { try { return JSON.stringify(v, null, 2) ?? 'undefined'; } catch { return String(v); } } // something that will not print is shown as its text

function Block({ title, children }) {
  return (<><h4>{title}</h4>{children}</>)
}
const Pre = ({ value }) => <pre>{typeof value === 'string' ? value : json(value)}</pre>

function Detail({ node, start }) {
  if (!node) return <section role="region" aria-label="Details" className="rt-detail"><p>Select a call to see what it was given and what it returned.</p></section>
  const d = node.data ?? {}
  const where = node.proc === 'main' ? 'Ran in the main process.' : node.proc === 'renderer' ? `Ran in a window${node.win != null ? ` (window ${node.win})` : ''}.` : null
  const copy = () => navigator.clipboard?.writeText(`${node.file}:${node.line}`)
  return (
    <section role="region" aria-label="Details" className="rt-detail">
      <h3>{node.title}</h3>
      <p>
        <span>{offsetLabel(node.start, start)} after the start</span>
        {node.ms != null && <span>{`, took ${durationLabel(node.ms)}`}</span>}
      </p>
      {where && <p>{where}</p>}
      {node.file && (
        <p>
          <span>{node.file}:{node.line}</span>{' '}
          <button className="btn sm ghost" aria-label="Copy location" onClick={copy}>Copy</button>
        </p>
      )}

      {(node.kind === 'call' || node.kind === 'action' || node.kind === 'ipc') && (
        <>
          <Block title="Arguments"><Pre value={node.args ?? []} /></Block>
          {node.error
            ? <Block title="Threw"><Pre value={node.error.stack ?? `${node.error.name}: ${node.error.message}`} /></Block>
            : node.done ? <Block title="Returned"><Pre value={node.value} /></Block> : <Block title="Did not finish"><p>The recording ended before this returned.</p></Block>}
        </>
      )}

      {node.kind === 'net' && (
        <>
          <Block title="Request">
            <p>{d.method} {d.url}</p>
            {d.headers && Object.keys(d.headers).length > 0 && <Pre value={d.headers} />}
            {d.body !== undefined && <Pre value={d.body} />}
          </Block>
          <Block title="Response">
            {d.error ? <p>{`Failed: ${d.error}`}</p> : <p>{d.status} {d.statusText}</p>}
            {d.responseHeaders && Object.keys(d.responseHeaders).length > 0 && <Pre value={d.responseHeaders} />}
            {d.responseBody !== undefined && <Pre value={d.responseBody} />}
          </Block>
        </>
      )}

      {node.kind === 'log' && (
        <>
          <Block title="Message"><p>{[d.mod, d.scope].filter(Boolean).join(' ')}</p><Pre value={d.msg ?? ''} /></Block>
          {d.err && <Block title="Error"><Pre value={d.err.stack ?? `${d.err.name}: ${d.err.message}`} /></Block>}
          {d.data !== undefined && <Block title="Data"><Pre value={d.data} /></Block>}
        </>
      )}

      {node.kind === 'click' && <Block title="Clicked"><p>{`${d.tag ?? 'control'} "${d.name ?? ''}"${d.page ? ` on ${d.page}` : ''}`}</p></Block>}
    </section>
  )
}

/** @param {{ recording: { header: object, events: object[] } }} props */
export function RecordingTree({ recording }) {
  const tree = React.useMemo(() => buildTree(recording.events ?? []), [recording])
  const failure = React.useMemo(() => firstError(tree), [tree])
  const failedPath = React.useMemo(() => {
    const ids = new Set()
    for (const n of tree.byId.values()) {
      if (!n.failed) continue
      for (let x = n; x && !ids.has(x.id); x = x.parent ? tree.byId.get(x.parent) : null) ids.add(x.id)
    }
    return ids
  }, [tree])

  const ancestorsOf = React.useCallback((node) => {
    const ids = []
    for (let x = node?.parent ? tree.byId.get(node.parent) : null; x; x = x.parent ? tree.byId.get(x.parent) : null) ids.push(x.id)
    return ids
  }, [tree])

  const [selectedId, setSelectedId] = React.useState(() => failure?.id ?? (tree.roots.find((r) => r.kind === 'click') ?? tree.roots[0])?.id ?? null)
  const [expanded, setExpanded] = React.useState(() => new Set(failure ? [...ancestorsOf(failure), failure.id] : []))
  const [errorsOnly, setErrorsOnly] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [limits, setLimits] = React.useState({})
  const [showBackground, setShowBackground] = React.useState(false)
  const treeRef = React.useRef(null)

  const searched = React.useMemo(() => searchTree(tree, query), [tree, query])
  const filter = React.useMemo(() => {
    if (!errorsOnly && !searched) return null
    if (!errorsOnly) return searched
    if (!searched) return failedPath
    return new Set([...searched].filter((id) => failedPath.has(id)))
  }, [errorsOnly, searched, failedPath])

  // The top level is what the person did. Work that nothing they did led to (timers, polling) is left out when they clicked
  // something, unless it failed or a search found it, and can be shown on request. With no clicks at all it is everything there is.
  const hasClicks = React.useMemo(() => tree.roots.some((r) => r.kind === 'click'), [tree])
  const background = React.useMemo(() => tree.roots.filter((r) => r.kind !== 'click' && !failedPath.has(r.id)), [tree, failedPath])
  const rootShown = (r) => !hasClicks || showBackground || r.kind === 'click' || failedPath.has(r.id) || !!searched?.has(r.id)
  const hiddenCount = hasClicks && !showBackground ? background.filter((r) => !searched?.has(r.id)).length : 0

  const items = React.useMemo(() => {
    const out = []
    const walk = (node, level) => {
      const kids = filter ? node.children.filter((k) => filter.has(k.id)) : node.children
      const open = filter ? kids.length > 0 : expanded.has(node.id)
      out.push({ node, level, hasKids: kids.length > 0, open })
      if (!open) return
      const limit = limits[node.id] ?? SHOW_FIRST
      for (const k of kids.slice(0, limit)) walk(k, level + 1)
      if (kids.length > limit) out.push({ more: kids.length - limit, parent: node.id, level: level + 1 })
    }
    for (const r of tree.roots) if ((!filter || filter.has(r.id)) && rootShown(r)) walk(r, 1)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, filter, expanded, limits, hasClicks, showBackground, failedPath, searched])

  const rowsOnly = items.filter((i) => i.node)
  const selected = selectedId ? tree.byId.get(selectedId) : null

  React.useEffect(() => {
    if (selectedId) treeRef.current?.querySelector(`[data-node="${CSS_ESCAPE(selectedId)}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId, items])

  const toggle = (id) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const onKeyDown = (event) => {
    const at = rowsOnly.findIndex((i) => i.node.id === selectedId)
    const cur = rowsOnly[at]
    const go = (i) => { const next = rowsOnly[Math.max(0, Math.min(rowsOnly.length - 1, i))]; if (next) setSelectedId(next.node.id) }
    switch (event.key) {
      case 'ArrowDown': go(at + 1); break
      case 'ArrowUp': go(at - 1); break
      case 'Home': go(0); break
      case 'End': go(rowsOnly.length - 1); break
      case 'ArrowRight':
        if (cur?.hasKids && !cur.open) toggle(cur.node.id)
        else if (cur?.open) go(at + 1)
        break
      case 'ArrowLeft':
        if (cur?.open && !filter) toggle(cur.node.id)
        else if (cur?.node.parent && tree.byId.get(cur.node.parent)) setSelectedId(cur.node.parent)
        break
      case 'Enter': case ' ': if (cur?.hasKids) toggle(cur.node.id); break
      default: return
    }
    event.preventDefault()
  }

  const header = recording.header ?? {}
  const empty = tree.count === 0

  return (
    <div className="rt">
      <style>{CSS}</style>
      <div className="rt-head">
        <h3>{header.label || 'Recording'}</h3>
        <span className="rt-note">{tree.count} {tree.count === 1 ? 'call or event' : 'calls and events'}</span>
        <div className="rt-tools">
          <input className="rt-field" type="search" aria-label="Search recording" placeholder="Search calls, values, requests" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn sm" aria-pressed={errorsOnly} onClick={() => setErrorsOnly((v) => !v)}>Errors only</button>
          {hasClicks && background.length > 0 && <button className="btn sm" aria-pressed={showBackground} onClick={() => setShowBackground((v) => !v)}>Background activity</button>}
        </div>
      </div>

      {(tree.capped || tree.unfinished.length > 0) && (
        <div role="status" className="rt-banner">
          {tree.capped && <div>{`This recording stopped at its size limit (${tree.capReason ?? 'size'}): what happened after that is not here.`}</div>}
          {tree.unfinished.length > 0 && <div>{`${tree.unfinished.length} ${tree.unfinished.length === 1 ? 'call' : 'calls'} did not finish: the recording ended, or the app closed, while they were running.`}</div>}
        </div>
      )}
      <p className="rt-note">Secrets that match a rule are hidden; everything else is shown.</p>
      {hiddenCount > 0 && <p className="rt-note">{`${hiddenCount} background ${hiddenCount === 1 ? 'action' : 'actions'} hidden`}</p>}

      <div className="rt-body">
        <div ref={treeRef} className="rt-tree" role="tree" aria-label="Recorded calls" tabIndex={0} aria-activedescendant={selectedId ? `rt-row-${selectedId}` : undefined} onKeyDown={onKeyDown}>
          {empty && <div className="rt-empty">Nothing was recorded. Start a recording, use the app, then stop it.</div>}
          {!empty && items.length === 0 && <div className="rt-empty">Nothing matches. Clear the search or turn off Errors only.</div>}
          {items.map((it) => (it.node ? (
            <div key={it.node.id} id={`rt-row-${it.node.id}`} data-node={it.node.id} role="treeitem" aria-level={it.level}
              aria-selected={it.node.id === selectedId} aria-expanded={it.hasKids ? it.open : undefined}
              data-failed={it.node.failed ? '' : undefined} className="rt-row" style={{ paddingLeft: 4 + (it.level - 1) * 16 }}
              onClick={() => setSelectedId(it.node.id)}>
              {it.hasKids
                ? <button className="rt-twist" tabIndex={-1} aria-label={`${it.open ? 'Collapse' : 'Expand'} ${it.node.title}`} onClick={(e) => { e.stopPropagation(); toggle(it.node.id) }}>{it.open ? '▾' : '▸'}</button>
                : <span className="rt-gap" aria-hidden />}
              <span className="rt-time">{offsetLabel(it.node.start, tree.start)}</span>
              <span className="rt-kind" data-kind={it.node.kind}>{KIND[it.node.kind]}</span>
              <span className="rt-title" title={it.node.title}>{it.node.title}</span>
              <span className="rt-ms">{it.node.ms != null ? durationLabel(it.node.ms) : ''}</span>
            </div>
          ) : (
            <div key={`more-${it.parent}`} role="presentation" className="rt-more" style={{ paddingLeft: 4 + (it.level - 1) * 16 }}>
              <button className="btn sm ghost" onClick={() => setLimits((l) => ({ ...l, [it.parent]: (l[it.parent] ?? SHOW_FIRST) + 100000 }))}>{`Show ${it.more} more`}</button>
            </div>
          )))}
        </div>
        <Detail node={selected} start={tree.start} />
      </div>
    </div>
  )
}

// An id is made of letters, digits and a dash, so it is safe in an attribute selector as it is.
const CSS_ESCAPE = (id) => String(id).replace(/["\\]/g, '')

export default RecordingTree
