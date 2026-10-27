import React from 'react'
import { ipcMessage } from './editor-store.js'

// A folder's contents, loaded when it is first opened. `api.list(dir)` gives
// { entries: [{ name, kind: 'dir' | 'file' | 'other', size }], truncated }.
const join = (dir, name) => dir.replace(/[\\/]+$/, '') + (dir.includes('\\') && !dir.includes('/') ? '\\' : '/') + name

function Rows({ dir, depth, api, openDirs, toggle, listings, onOpenFile, activePath }) {
  const listing = listings[dir]
  if (!listing) return <div className="nx-ed-tree-note" style={{ paddingLeft: 8 + depth * 14 }}>Loading…</div>
  if (listing.error) return <div className="nx-ed-tree-note nx-ed-bad" role="alert" style={{ paddingLeft: 8 + depth * 14 }}>{listing.error}</div>
  return (
    <>
      {listing.entries.map(e => {
        const full = join(dir, e.name)
        const pad = { paddingLeft: 8 + depth * 14 }
        if (e.kind === 'dir') {
          const open = openDirs.has(full)
          return (
            <React.Fragment key={full}>
              <div role="treeitem" aria-expanded={open} aria-level={depth + 1} tabIndex={0} className="nx-ed-row nx-ed-dir" style={pad}
                onClick={() => toggle(full)}
                onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(full) } }}>
                <span aria-hidden="true">{open ? '▾' : '▸'}</span> {e.name}
              </div>
              {open && <div role="group"><Rows dir={full} depth={depth + 1} api={api} openDirs={openDirs} toggle={toggle} listings={listings} onOpenFile={onOpenFile} activePath={activePath} /></div>}
            </React.Fragment>
          )
        }
        return (
          <div key={full} role="treeitem" aria-level={depth + 1} aria-selected={full === activePath} tabIndex={0}
            className={`nx-ed-row nx-ed-file${full === activePath ? ' nx-ed-active' : ''}${e.kind === 'other' ? ' nx-ed-muted' : ''}`} style={pad}
            onClick={() => e.kind === 'file' && onOpenFile(full)}
            onKeyDown={ev => { if ((ev.key === 'Enter' || ev.key === ' ') && e.kind === 'file') { ev.preventDefault(); onOpenFile(full) } }}>
            {e.name}
          </div>
        )
      })}
      {listing.truncated && <div className="nx-ed-tree-note" style={{ paddingLeft: 8 + depth * 14 }}>Only the first part of this folder is shown.</div>}
    </>
  )
}

export function FolderTree({ root, api, onOpenFile, activePath }) {
  const [listings, setListings] = React.useState({})
  const [openDirs, setOpenDirs] = React.useState(() => new Set())

  const load = React.useCallback(async dir => {
    try {
      const r = await api.list(dir)
      setListings(l => ({ ...l, [dir]: { entries: r.entries, truncated: r.truncated } }))
    } catch (e) {
      setListings(l => ({ ...l, [dir]: { error: ipcMessage(e) || 'Could not read this folder.' } }))
    }
  }, [api])

  // A different folder starts a fresh tree.
  React.useEffect(() => { setListings({}); setOpenDirs(new Set()); load(root) }, [root, load])

  const toggle = dir => {
    setOpenDirs(prev => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else { next.add(dir); if (!listings[dir]) load(dir) }
      return next
    })
  }

  return (
    <div role="tree" aria-label="Folder" className="nx-ed-tree">
      <Rows dir={root} depth={0} api={api} openDirs={openDirs} toggle={toggle} listings={listings} onOpenFile={onOpenFile} activePath={activePath} />
    </div>
  )
}
