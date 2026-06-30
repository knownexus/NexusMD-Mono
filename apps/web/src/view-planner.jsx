// Pure planner schema + date helpers now live in @nexusmd/core (Phase 5).
// Re-exported here so existing `./view-planner.jsx` importers keep working.
import {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekStorageKey, weekKeyToOffset,
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup,
  buildEmptyPlannerData, hasMeaningfulPlannerData,
} from '@nexusmd/core';
export {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekStorageKey, weekKeyToOffset,
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup,
  buildEmptyPlannerData, hasMeaningfulPlannerData,
};
// Per-week storage, versions, migration flag + confidential reminder scan now
// live in @nexusmd/ui (planner runtime seam). Re-exported so existing importers
// (view-planner-2.jsx, view-settings.jsx) keep working unchanged.
export {
  loadWeekPlanner, saveWeekPlanner, deleteWeekPlanner, getWeeksWithData,
  isLegacyMigrationDone, markLegacyMigrationDone, checkConfidentialReminders,
  loadVersions, saveVersions, describeSnapshot,
} from '@nexusmd/ui';

export { PlannerView, plannerExportDocx } from '@nexusmd/ui';
