// view-documents.jsx — shared "Documents" page shell: one top bar (the tool tabs and the open document's save
// state) plus the active tool's content area. New tools (LINQ-to-SQL) get added as tabs here in later specs.
import React from 'react'
import { usePersisted } from '../app-components.jsx'
import { MarkdownViewer } from './MarkdownViewer.jsx'
import { JsonEditorView } from './view-json-editor.jsx'
import { RegexTesterView } from './view-regex-tester.jsx'
import { DocumentsBar, DocumentsBarContext } from './documents-bar.jsx'

const TABS = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'json', label: 'JSON Editor' },
  { id: 'regex', label: 'Regex Tester' },
]
const STORAGE_KEY = 'documents_active_tab'

// `opened` counts the files the app was opened with (Android "Open with" / Share). A file is added to the saved
// documents, so the Markdown tool is shown with the newest one open, whichever tool was last in use.
export function DocumentsView({ opened = 0 }) {
  const [activeTab, setActiveTab] = usePersisted(STORAGE_KEY, 'markdown')
  React.useLayoutEffect(() => { if (opened) setActiveTab('markdown') }, [opened]) // eslint-disable-line react-hooks/exhaustive-deps
  const tab = opened ? 'markdown' : TABS.some(t => t.id === activeTab) ? activeTab : 'markdown'
  // The save state the active tool reports; null while it reports none.
  const [save, setSave] = React.useState(null)
  const context = React.useMemo(() => ({ setSave }), [])

  return (
    <DocumentsBarContext.Provider value={context}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <DocumentsBar tabs={TABS} tab={tab} onTab={setActiveTab} save={save} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {tab === 'markdown' ? <MarkdownViewer openNewest={opened > 0}/> : tab === 'json' ? <JsonEditorView/> : <RegexTesterView/>}
        </div>
      </div>
    </DocumentsBarContext.Provider>
  )
}
