import DesktopNotesView from './desktop-notes-view.jsx'

// What the shell gets from the Notes app (see apps/desktop/src/shell/modules.js).
export default {
  id: 'notes',
  views: { notes: DesktopNotesView },
}
