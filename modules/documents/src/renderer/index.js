import { DocumentsApp } from './documents-app.jsx'
import { openedFiles } from './opened.js'

// What the shell gets from the Documents app (see apps/desktop/src/shell/modules.js). Its view id
// is still 'markdown'.
//   documents.openFile({ name, text })   save a Markdown or JSON file as a document and show it (other apps, e.g. the Editor,
//                                        pass the files the app was opened with); rejects with a message for any other file
export default {
  id: 'documents',
  views: { markdown: DocumentsApp },
  activate(host) {
    host.capabilities.provide('documents.openFile', async file => {
      const result = openedFiles.add(file)
      host.navigate('markdown')
      return result
    })
  },
}
