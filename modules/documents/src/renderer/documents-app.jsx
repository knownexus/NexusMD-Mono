import React from 'react'
import { DocumentsView } from '@nexusmd/ui'
import { openedFiles } from './opened.js'

// The Documents screen: markdown documents, the JSON editor and the regex tester.
// A Markdown or JSON file the app was opened with is a new saved document: the screen starts again on it, in its tool.
// A Home shortcut to a saved document does the same on that document.
export function DocumentsApp() {
  const { count, tool, docId } = React.useSyncExternalStore(openedFiles.subscribe, openedFiles.getSnapshot)
  return <DocumentsView key={count} opened={count} openedTool={tool} openDocId={docId} />
}
