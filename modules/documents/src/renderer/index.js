import { DocumentsApp } from './documents-app.jsx'

// What the shell gets from the Documents app (see apps/desktop/src/shell/modules.js). Its view id
// is still 'markdown'.
export default {
  id: 'documents',
  views: { markdown: DocumentsApp },
}
