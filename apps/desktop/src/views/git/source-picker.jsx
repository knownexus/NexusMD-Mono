import React from 'react'
import { PlModal } from '@nexusmd/ui'
import { parseRefList, filterByWords, sourceName } from '@nexusmd/core'
import { ipcMessage } from './use-git-actions.js'

/**
 * Pick the branch `branch` was cut from: local and remote branches (not itself), narrowed by word starts
 * as you type. Picking runs setSource right away (preview, then run); a refusal or failure shows inline.
 * `onPicked()` fires once it is saved.
 */
export function SourcePicker({ adapter, repo, cwd, registered, branch, current, onClose, onPicked }) {
  const [refs, setRefs] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const [index, setIndex] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  React.useEffect(() => {
    let live = true
    adapter.refs(repo, cwd, registered).then(
      r => { if (live) setRefs(parseRefList(r.refs).map(x => x.ref).filter(ref => /^refs\/(heads|remotes)\//.test(ref) && !ref.endsWith('/HEAD') && ref !== `refs/heads/${branch}`)) },
      e => { if (live) { setRefs([]); setError(ipcMessage(e)) } },
    )
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- repo is a fresh object each render
  }, [adapter, repo.path, cwd, branch])
  const results = React.useMemo(() => filterByWords(refs ?? [], query, sourceName), [refs, query])
  const at = Math.min(index, Math.max(0, results.length - 1))

  const pick = async ref => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const params = { branch, ref }
      const p = await adapter.preview(repo, cwd, registered, 'setSource', params)
      if (!p.eligible) { setError(p.reason || "Can't use that branch"); return }
      const r = await adapter.run(repo, cwd, registered, 'setSource', params, p.stamp)
      if (!r.ok) { setError(r.detail || "Couldn't save the source branch"); return }
      onPicked()
    } catch (e) {
      setError(ipcMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const onKeyDown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(Math.min(at + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(Math.max(at - 1, 0)) }
    else if (e.key === 'Enter' && results[at]) { e.preventDefault(); pick(results[at]) }
  }
  return (
    <PlModal open onClose={onClose} title={`Source branch for ${branch}`} icon="git-branch" className="nx-gw-palette">
      <div style={{ display: 'grid', gap: 8 }}>
        <input autoFocus role="combobox" aria-label="Source branch" aria-autocomplete="list" aria-controls="source-picker-list" aria-expanded={!!results.length}
          placeholder="Type a branch name" value={query} onKeyDown={onKeyDown} onChange={e => { setQuery(e.target.value); setIndex(0) }} className="nx-gw-pal-input" />
        {error && <div role="alert" className="nx-alert bad">{error}</div>}
        <div id="source-picker-list" role="listbox" aria-label="Branches" className="nx-gw-pal-list">
          {results.map((ref, i) => (
            <div key={ref} role="option" data-name={sourceName(ref)} aria-selected={i === at} aria-current={ref === current ? 'true' : undefined}
              className="nx-gw-pal-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }} onClick={() => pick(ref)} onMouseMove={() => { if (i !== at) setIndex(i) }}>
              <span className="nx-gw-pal-main"><span className="b">{sourceName(ref)}</span></span>
              {ref === current && <span className="nx-gw-pal-meta">current</span>}
            </div>
          ))}
        </div>
        {refs && !results.length && <div style={{ color: 'var(--text-muted)' }}>No branches match.</div>}
      </div>
    </PlModal>
  )
}
