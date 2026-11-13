import { DocumentsApp } from './documents-app.jsx'
import { openedFiles } from './opened.js'

// What the shell gets from the Documents app (see apps/desktop/src/shell/modules.js). Its view id
// is still 'markdown'.
//   documents.openFile({ name, text })   save a Markdown or JSON file as a document and show it (other apps, e.g. the Editor,
//                                        pass the files the app was opened with); rejects with a message for any other file
//   documents.openDoc({ tool, docId })   show one saved document ('markdown' or 'json'); false when it no longer exists (Home shortcuts)
export default {
  id: 'documents',
  views: { markdown: DocumentsApp },
  activate(host) {
    host.capabilities.provide('documents.openFile', async file => {
      const result = openedFiles.add(file)
      host.navigate('markdown')
      return result
    })
    host.capabilities.provide('documents.openDoc', spec => {
      const { ok } = openedFiles.openDoc(spec)
      if (ok) host.navigate('markdown')
      return ok
    })
  },
}
