// planner-ui.jsx — promoted to @nexusmd/ui (shared with web). Re-exported here and
// re-exposed on window so the app's legacy planner views (which reference these as
// free globals) keep working unchanged.
import {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd, qaParseDue,
  StatusChip, PrioChip, PlModal, PlFld, DueLabel,
  PlannerDatePicker, PlannerDateTimePicker, ColInput, qaParse, plNewRow, plScrollToEl,
} from '@nexusmd/ui'

Object.assign(window, {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd,
  StatusChip, PrioChip, PlModal, PlFld, ColInput, DueLabel,
  qaParse, qaParseDue, plNewRow, plScrollToEl,
})

export {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd, qaParseDue,
  StatusChip, PrioChip, PlModal, PlFld, DueLabel,
  PlannerDatePicker, PlannerDateTimePicker, ColInput, qaParse, plNewRow, plScrollToEl,
}
