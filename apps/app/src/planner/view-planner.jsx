import React from 'react';
import { PrioChip } from './planner-ui.jsx';
// Pure date math + planner group structure live in @nexusmd/core (identical to
// web). Imported + re-exported here so this module's surface is unchanged;
// PLANNER_SECTIONS is now canonical in @nexusmd/core.
import {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekKeyToOffset, PL_GROUPS, plSectionGroup,
  PLANNER_SECTIONS, buildEmptyPlannerData, hasMeaningfulPlannerData,
} from '@nexusmd/core';
import {
  hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer,
  loadConfidentialConfig, saveConfidentialConfig,
  loadWeekPlanner, saveWeekPlanner, deleteWeekPlanner, getWeeksWithData,
  isLegacyMigrationDone, markLegacyMigrationDone, checkConfidentialReminders,
  loadVersions, saveVersions, describeSnapshot,
} from '@nexusmd/ui';
// view-planner.jsx — Weekly planner v2
// Redesign: glance overview, grouped navigation (rail/scroll/tabs), three entry
// styles (inline/quick-add/drawer), carry-over, multi-notes, week-agnostic notes.
// Preserved from v1: DOCX export, per-week storage + legacy migration, versions,
// confidential sections/rows (SHA-256 + AES-GCM sync), calendar picker,
// NexusMDNav navigation, helm:create-wi context menu.
// Requires (load before this file): planner-ui.jsx, planner-notes.jsx,
// planner-editors.jsx, planner-glance.jsx, @nexusmd/ui planner-v2.css.

// Version helpers (loadVersions/saveVersions/describeSnapshot) now live in
// @nexusmd/ui — imported above, re-exported below.

// Date helpers (getIsoYearWeek/getYearWeekForOffset/getMondayOfDate/getIsoWeek/
// fmtDateShort/weekKeyToOffset) + PL_GROUPS/plSectionGroup + PLANNER_SECTIONS/
// buildEmptyPlannerData/hasMeaningfulPlannerData now come from @nexusmd/core —
// imported above, re-exported below.

// The storage helpers (loadWeekPlanner/saveWeekPlanner/deleteWeekPlanner/
// getWeeksWithData, is/markLegacyMigrationDone, checkConfidentialReminders) now
// live in @nexusmd/ui — imported above, re-exported below.

// Kept only because it's still in the public re-export surface of this module.
const PLANNER_MIGRATION_FLAG = 'helm.planner.legacyMigrated';

// ── Confidential helpers ──────────────────────────────────────
// hashPassword / encrypt / decryptConfidentialForServer (pure AES-GCM) now live
// in @nexusmd/core; loadConfidentialConfig / saveConfidentialConfig (storage +
// pref-sync, namespaced via the planner runtime) live in @nexusmd/ui. Both are
// imported at the top of this file and re-exported below.

const { useState: useStatePL, useEffect: useEffectPL, useMemo: useMemoPL, useRef: useRefPL, useCallback: useCallbackPL } = React;

// PL_GROUPS / plSectionGroup / getIsoWeek / fmtDateShort / weekKeyToOffset now
// come from @nexusmd/core (imported at top). checkConfidentialReminders lives in
// @nexusmd/ui.

export {
  useStatePL, useEffectPL, useMemoPL, useRefPL, useCallbackPL,
  PLANNER_SECTIONS, PL_GROUPS, PLANNER_MIGRATION_FLAG,
  getIsoYearWeek, getIsoWeek, getYearWeekForOffset, getMondayOfDate,
  loadWeekPlanner, saveWeekPlanner, deleteWeekPlanner,
  getWeeksWithData, weekKeyToOffset, fmtDateShort, plSectionGroup,
  loadVersions, saveVersions, describeSnapshot, buildEmptyPlannerData,
  hasMeaningfulPlannerData, isLegacyMigrationDone, markLegacyMigrationDone,
  hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer,
  loadConfidentialConfig, saveConfidentialConfig, checkConfidentialReminders,
};
export { PlannerView, plannerExportDocx } from '@nexusmd/ui';
