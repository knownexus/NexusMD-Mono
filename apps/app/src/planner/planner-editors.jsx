// planner-editors.jsx — promoted to @nexusmd/ui (shared with web). Re-exported here
// and re-exposed on window for the app's legacy planner views.
import {
  LockRowControls, HintControl, ReminderControl, LockedRowNotice,
  InlineTable, QuickAddList, DrawerTable, ThemesGrid, EowGrid, SectionCard,
} from '@nexusmd/ui'

Object.assign(window, {
  InlineTable, QuickAddList, DrawerTable, ThemesGrid, EowGrid, SectionCard,
  LockRowControls, LockedRowNotice,
})

export {
  LockRowControls, HintControl, ReminderControl, LockedRowNotice,
  InlineTable, QuickAddList, DrawerTable, ThemesGrid, EowGrid, SectionCard,
}
