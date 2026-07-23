// view-documents.jsx — shared "Documents" page shell: a tool tab bar plus the
// active tool's content area. New tools (Regex Tester, LINQ-to-SQL) get added
// as tabs here in later specs.
import React from 'react'
import { usePersisted } from '../app-components.jsx'
import { MarkdownViewer } from './MarkdownViewer.jsx'
import { JsonEditorView } from './view-json-editor.jsx'

const TABS = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON Editor' },
]
const STORAGE_KEY = 'documents_active_tab'

export function DocumentsView() {
  const [activeTab, setActiveTab] = usePersisted(STORAGE_KEY, 'markdown')
  const tab = TABS.some(t => t.id === activeTab) ? activeTab : 'markdown'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 4, padding: '6px 10px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
              fontSize: 12.5, fontWeight: 500,
              background: tab === t.id ? 'var(--accent)' : 'transparent',
              color: tab === t.id ? 'var(--accent-fg)' : 'var(--text-muted)',
            }}
          >{t.label}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'markdown' ? <MarkdownViewer/> : <JsonEditorView/>}
      </div>
    </div>
  )
}
