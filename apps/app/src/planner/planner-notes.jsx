// planner-notes.jsx — promoted to @nexusmd/ui (shared with web). Re-exported here
// and re-exposed on window for the app's legacy planner views.
import {
  plMdToHtml, plRowNotes, plOpenCtx, WorkItemCtxLayer, NotesEditor,
  RowNotesModal, NotesButton, loadGlobalNotes, saveGlobalNotes, GlobalNoteModal, GlobalNotesView,
} from '@nexusmd/ui'

Object.assign(window, {
  plMdToHtml, plRowNotes, plOpenCtx, WorkItemCtxLayer,
  NotesEditor, RowNotesModal, NotesButton,
  loadGlobalNotes, saveGlobalNotes, GlobalNotesView,
})

export {
  plMdToHtml, plRowNotes, plOpenCtx, WorkItemCtxLayer, NotesEditor,
  RowNotesModal, NotesButton, loadGlobalNotes, saveGlobalNotes, GlobalNoteModal, GlobalNotesView,
}
