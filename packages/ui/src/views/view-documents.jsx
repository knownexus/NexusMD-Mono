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

// `opened` counts the files the app was opened with (Android "Open with" / Share). A file is added to the saved documents of
// the tool named by `openedTool` ('markdown' or 'json'), so that tool is shown with the newest document open, whichever tool
// was last in use. The person can pick another tool afterwards.
export function DocumentsView({ opened = 0, openedTool = 'markdown' }) {
  const [activeTab, setActiveTab] = usePersisted(STORAGE_KEY, 'markdown')
  // The tool the opened file is in, until the person picks another tab.
  const [fileTool, setFileTool] = React.useState(opened ? openedTool : null)
  React.useLayoutEffect(() => {
    if (!opened) return
    setFileTool(openedTool)
    setActiveTab(openedTool)
  }, [opened, openedTool]) // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = fileTool ?? activeTab
  const tab = TABS.some(t => t.id === chosen) ? chosen : 'markdown'
  const pickTab = (id) => { setFileTool(null); setActiveTab(id) }
  // The save state the active tool reports; null while it reports none.
  const [save, setSave] = React.useState(null)
  const context = React.useMemo(() => ({ setSave }), [])

  return (
    <DocumentsBarContext.Provider value={context}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <DocumentsBar tabs={TABS} tab={tab} onTab={pickTab} save={save} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {tab === 'markdown' ? <MarkdownViewer openNewest={fileTool === 'markdown'}/> : tab === 'json' ? <JsonEditorView openNewest={fileTool === 'json'}/> : <RegexTesterView/>}
        </div>
      </div>
    </DocumentsBarContext.Provider>
  )
}
