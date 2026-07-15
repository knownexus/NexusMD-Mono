export { core, initCore } from './core.js'
export { registerModule } from './features/module-registry.js'
export {
  IFileAdapter, IHttpAdapter, IStorageAdapter,
  INotificationAdapter, IPickerAdapter, IAuthAdapter, IClipboardAdapter,
  ISecureStorageAdapter, INetworkAdapter, ILifecycleAdapter, IShareAdapter,
  ITrayAdapter, INavigationAdapter, IThemeAdapter, IUpdateAdapter,
  IBadgeAdapter, IDeepLinkAdapter, IScriptRunnerAdapter, IRawHttpAdapter,
} from './adapters/index.js'
export { createNoOpAdapters } from './adapters/defaults.js'
export {
  listProfiles, createProfile, activateProfile,
  deleteProfile, importProfile, exportProfile,
} from './profiles/profile-store.js'
export { validateProfile, buildProfile, generateProfileId, CURRENT_PROFILE_VERSION } from './profiles/profile-schema.js'
export { makeProfileKeys } from './profiles/profile-keys.js'
export * from './modules/ado/index.js'
export { effectiveNeedsMe, effectiveTeamActivity } from './modules/pr/index.js'
export { mergeTeamRoster, enrichTeamMember, enrichTeam } from './modules/team/index.js'
export {
  getIsoYearWeek, getYearWeekForOffset, getMondayOfDate, getIsoWeek,
  fmtDateShort, weekStorageKey, weekKeyToOffset,
  PLANNER_SECTIONS, PL_GROUPS, plSectionGroup,
  buildEmptyPlannerData, hasMeaningfulPlannerData,
  // Planner v2 date/status helpers
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd, qaParseDue,
  // Confidential AES-GCM crypto
  hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer,
} from './modules/planner/index.js'
export {
  encodeBundle, decodeBundle, BUNDLE_FORMAT, BUNDLE_FORMAT_ENC, BUNDLE_VERSION, BUNDLE_EXT,
} from './modules/profiles/bundle.js'
export { planProfileScopeMigration } from './modules/profiles/migrate.js'
export { stableStringify, contentHash } from './modules/sync/hash.js'
export {
  mergeRows, mergeKeyVal, mergeText, mergeSet, mergePlannerWeek,
} from './modules/sync/merge.js'
export { reconcileItem } from './modules/sync/reconcile.js'
export { filterTriageItems, buildTriageCsv } from './modules/triage/index.js'
export {
  isAllDayEvent, getEventsForDay, sortEventsByTime,
  buildAlertKey, pendingAlerts,
} from './modules/calendar/index.js'
export { buildDigest } from './modules/digest/index.js'
export { appendAuditEntry, readAuditLog } from './modules/audit/index.js'
export {
  getApiClientAdapters,
  createCollection, readCollectionMeta, writeCollectionMeta,
  listRequestIds, readRequest, writeRequest, deleteRequest,
  listEnvironmentNames, readEnvironment, writeEnvironment, deleteEnvironment,
  loadCollection, addTreeNode, removeTreeNode, findTreeNode, flattenRequestRefs,
  resolveVars, resolveObjectVars, resolveEnvironment,
  secretStorageKey, setSecretVar, removeSecretVar,
  buildRequest, executeRequest,
  buildRunEntries, runCollection,
  importPostmanCollection,
  appendHistoryEntry, readHistory, clearHistory,
} from './modules/api-client/index.js'
export {
  createTimer, elapsedMs, start as startTimer, pause as pauseTimer,
  resume as resumeTimer, stop as stopTimer, reset as resetTimer, lap as lapTimer,
  remainingMs, isExpired, formatDuration, formatClock,
} from './modules/timer/index.js'
