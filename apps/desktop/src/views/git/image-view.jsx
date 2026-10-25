import React from 'react'
import { diffSides } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'

const kb = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`)

// Loads once per `loadKey` (the image's identity and what it was last changed to), not per render.
function useLoaded(load, loadKey) {
  const [state, setState] = React.useState({ status: 'loading' })
  const latest = React.useRef(load)
  latest.current = load
  React.useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    latest.current().then(
      r => { if (live) setState(r?.missing ? { status: 'missing' } : { status: 'ready', ...r }) },
      e => { if (live) setState({ status: 'error', error: ipcMessage(e) }) },
    )
    return () => { live = false }
  }, [loadKey])
  return state
}

/**
 * One image on a checkerboard so transparency shows, scaled down to fit; click for its actual size.
 * `load()` resolves { url, size, mime } or { missing: true } (then `emptyText` is shown).
 */
export function ImageView({ load, loadKey, name, emptyText = 'No image.' }) {
  const s = useLoaded(load, loadKey)
  const [actual, setActual] = React.useState(false)
  const [dims, setDims] = React.useState(null)
  if (s.status === 'loading') return <div className="nx-muted">Loading…</div>
  if (s.status === 'error') return <div role="alert" className="nx-alert bad">{s.error}</div>
  if (s.status === 'missing') return <div role="note" className="nx-muted">{emptyText}</div>
  return (
    <figure className="nx-img">
      <div className="nx-img-frame" data-actual={actual || undefined}>
        <img src={s.url} alt={name} title={actual ? 'Click to fit' : 'Click for actual size'}
          onClick={() => setActual(a => !a)}
          onLoad={e => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setDims(null)} />
      </div>
      <figcaption>{`${dims ? `${dims.w} × ${dims.h} · ` : ''}${kb(s.size)}`}</figcaption>
    </figure>
  )
}

// Where each side of a change's diff comes from.
const SOURCES = {
  unstaged: { old: 'index', new: 'working' },
  staged: { old: 'head', new: 'index' },
  untracked: { old: null, new: 'working' },
}

/**
 * A changed image as before and after, side by side. `load(side, rel)` reads one side
 * ('working' | 'index' | 'head'); a side that doesn't exist says so (added or deleted).
 */
export function ImageDiff({ change, load, loadKey }) {
  const src = SOURCES[change.area]
  const sides = diffSides(change)
  if (!src) return null
  const oldRel = change.originalPath ?? change.path
  return (
    <div className="nx-img-diff" aria-label="Image diff">
      {src.old && (
        <section aria-label="Old image">
          <div className="nx-img-label" data-side="old">{`− old: ${sides.old}`}</div>
          <ImageView name={`${oldRel} (old)`} load={() => load(src.old, oldRel)} loadKey={`${loadKey}|old|${oldRel}`} emptyText="Did not exist before." />
        </section>
      )}
      <section aria-label="New image">
        <div className="nx-img-label" data-side="new">{src.old ? `+ new: ${sides.new}` : `+ ${sides.new}`}</div>
        <ImageView name={`${change.path} (new)`} load={() => load(src.new, change.path)} loadKey={`${loadKey}|new|${change.path}`} emptyText="Deleted." />
      </section>
    </div>
  )
}

/** A worktree image file where the editor would be: the picture, with a reload for when it changes on disk. */
export function ImageFile({ adapter, repo, worktreePath, registered, path }) {
  const [nonce, setNonce] = React.useState(0)
  const deps = React.useRef({ adapter, repo, registered })
  deps.current = { adapter, repo, registered }
  return (
    <section aria-label="Image" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 6 }}>
      <div className="nx-editor-head" style={{ padding: '4px 0' }}>
        <span className="nx-editor-path nx-trunc" title={path}>{path}</span>
        <span className="row" style={{ marginLeft: 'auto', gap: 8 }}>
          <button className="btn sm ghost" onClick={() => setNonce(n => n + 1)}>Reload</button>
        </span>
      </div>
      <div style={{ overflow: 'auto', minHeight: 0 }}>
        <ImageView name={path} loadKey={`${worktreePath}|${path}|${nonce}`} emptyText={`${path} no longer exists.`}
          load={() => deps.current.adapter.readImage(deps.current.repo, worktreePath, deps.current.registered, path, 'working')} />
      </div>
    </section>
  )
}
