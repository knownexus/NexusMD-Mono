export { core, initCore } from './core.js'
export { registerModule } from './features/module-registry.js'
export {
  IFileAdapter, IHttpAdapter, IStorageAdapter,
  INotificationAdapter, IPickerAdapter, IAuthAdapter, IClipboardAdapter,
  ISecureStorageAdapter, INetworkAdapter, ILifecycleAdapter, IShareAdapter,
  ITrayAdapter, INavigationAdapter, IThemeAdapter, IUpdateAdapter,
  IBadgeAdapter, IDeepLinkAdapter,
} from './adapters/index.js'
export { createNoOpAdapters } from './adapters/defaults.js'
export {
  listProfiles, createProfile, activateProfile,
  deleteProfile, importProfile, exportProfile,
} from './profiles/profile-store.js'
export { validateProfile, buildProfile, generateProfileId, CURRENT_PROFILE_VERSION } from './profiles/profile-schema.js'
export * from './modules/ado/index.js'
export { mergeTeamRoster, enrichTeamMember, enrichTeam } from './modules/team/index.js'
export {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekStorageKey, weekKeyToOffset,
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup,
  buildEmptyPlannerData, hasMeaningfulPlannerData,
} from './modules/planner/index.js'
export { filterTriageItems, buildTriageCsv } from './modules/triage/index.js'
export {
  isAllDayEvent, getEventsForDay, sortEventsByTime,
  buildAlertKey, pendingAlerts,
} from './modules/calendar/index.js'
export { buildDigest } from './modules/digest/index.js'
export { appendAuditEntry, readAuditLog } from './modules/audit/index.js'
