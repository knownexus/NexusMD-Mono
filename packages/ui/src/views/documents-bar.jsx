// documents-bar.jsx — the Documents page's one top bar: the tool tabs on the left, the open document's save
// state on the right. A tool tells the bar how its document is saving with useDocumentsBarSave.
import React from 'react'
import { Segmented } from '../segmented.jsx'
import { relativeTime } from './document-store.js'

export const DocumentsBarContext = React.createContext({ setSave: () => {} })

/**
 * Reports a tool's save status ('' | 'saving' | 'saved' | 'unsaved', as useDocumentAutosave gives it) to the
 * bar for as long as the tool is shown. The bar remembers when the last save happened.
 */
export function useDocumentsBarSave(status) {
  const { setSave } = React.useContext(DocumentsBarContext)
  React.useEffect(() => {
    setSave(prev => (status === 'saved' ? { status, savedAt: Date.now() } : { status, savedAt: prev?.savedAt ?? null }))
  }, [status, setSave])
  React.useEffect(() => () => setSave(null), [setSave])
}

// "● Saving…" (a warning dot), "● Saved just now" (a success dot), or nothing before the first save.
function SaveState({ save }) {
  if (!save) return null
  const busy = save.status === 'saving' || save.status === 'unsaved'
  if (!busy && !save.savedAt) return null
  return (
    <span className="nx-docs-save" role="status">
      <span className="nx-gw-dot" data-tone={busy ? 'warn' : 'ok'} />
      <span>{busy ? 'Saving…' : `Saved ${relativeTime(save.savedAt)}`}</span>
    </span>
  )
}

export function DocumentsBar({ tabs, tab, onTab, save }) {
  return (
    <div className="nx-docs-bar" style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 14, height: 48, padding: '0 16px', boxSizing: 'border-box', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <Segmented ariaLabel="Documents tool" value={tab} onChange={onTab} options={tabs} />
      <span style={{ flex: 1 }} />
      <SaveState save={save} />
    </div>
  )
}
