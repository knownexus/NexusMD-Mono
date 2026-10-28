export { core, initCore } from './core.js'
export { registerModule } from './features/module-registry.js'
export {
  IFileAdapter, IHttpAdapter, IStorageAdapter,
  INotificationAdapter, IPickerAdapter, IAuthAdapter, IClipboardAdapter,
  ISecureStorageAdapter, INetworkAdapter, ILifecycleAdapter, IShareAdapter,
  ITrayAdapter, INavigationAdapter, IThemeAdapter, IUpdateAdapter,
  IBadgeAdapter, IDeepLinkAdapter, IScriptRunnerAdapter, IRawHttpAdapter,
  IDbManagerAdapter, IDevenvAdapter, IGitAdapter,
} from './adapters/index.js'
export { createNoOpAdapters } from './adapters/defaults.js'
export {
  listProfiles, createProfile, activateProfile,
  deleteProfile, importProfile, exportProfile,
} from './profiles/profile-store.js'
export { validateProfile, buildProfile, generateProfileId, CURRENT_PROFILE_VERSION } from './profiles/profile-schema.js'
export { makeProfileKeys } from './profiles/profile-keys.js'
export * from './modules/ado/index.js'
export * from './modules/workitems/index.js'
export * from './modules/jira/index.js'
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
export { encryptSync, decryptSync } from './modules/sync/crypto.js'
export {
  plannerCollection, notesCollection, teamCustomCollection, teamRemovedCollection, tweaksCollection,
} from './modules/sync/collections.js'
export { createSyncRuntime } from './modules/sync/runtime.js'
export { startAutoSync } from './modules/sync/auto.js'
export { singleFlight } from './modules/sync/single-flight.js'
export { exportBundle, importBundle } from './modules/sync/local-bundle.js'
export { createSyncController } from './modules/sync/controller.js'
export { graphFetch, graphJSON, graphList } from './modules/graph/client.js'
export { makeGoogleDriveProvider, makeOneDriveProvider } from './modules/cloud/providers.js'
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
  buildRunEntries, runCollection, nextRuntimeVars,
  importPostmanCollection, importBrunoCollection, parseBru,
  executeBrunoRequest, brunoRequestLookup, normalizeBrunoPath,
  appendHistoryEntry, readHistory, clearHistory,
} from './modules/api-client/index.js'
export {
  createTimer, elapsedMs, start as startTimer, pause as pauseTimer,
  resume as resumeTimer, stop as stopTimer, reset as resetTimer, lap as lapTimer,
  remainingMs, isExpired, formatDuration, formatClock,
} from './modules/timer/index.js'
export {
  getDbManagerAdapter, parseConnectionString, buildConfig, resolveConnectionParams, buildConnectionString,
  SQL_AUTH, AZURE_AD_INTERACTIVE, connectionStringToFields,
  createInitialState, applyConnected, applyDisconnected,
  applyTableSelected, applyTableLoaded, applyRowsDeleted, applyCellUpdated, applyError,
  generateConnectionId, upsertConnection, removeConnection,
} from './modules/db-manager/index.js'
export {
  normalizeTablePrefs, toggleTableStarred, toggleTableHidden, setTableGroup, renameTableGroup,
  removeTableGroup, toggleSectionCollapsed, tableSections, groupSectionKey, schemaSectionKey, VIEWS_SECTION_KEY,
} from './modules/db-manager/table-prefs.js'
export {
  columnTypes, validateTableSpec, buildCreateTable, buildCreateView, buildDropStatement, formatDefault, isSingleStatement,
} from './modules/db-manager/ddl.js'
export { columnKind, isPartialInput, cellToInput, parseCellInput } from './modules/db-manager/cell-types.js'
export {
  formatSqlValue, formatCondition, quoteIdent, quoteTable,
  buildSearchQuery, buildInsertQuery, buildUpdateQuery, buildDeleteQuery,
  buildJoinQuery, buildAggregateQuery, sqlLiteral, buildInsertStatements,
} from './modules/db-manager/query-builders.js'
export { followTargets, referencingTargets, whereLabel } from './modules/db-manager/foreign-keys.js'
export {
  getDevenvAdapter, DEVENV_CONTROL_PREFIX, DEVENV_PROTOCOL_VERSION, parseDevenvLine,
  ansiToSpans, stripAnsi,
  DEVENV_MAX_LINES, createRunState, applyStarting, applyStarted, applyStartFailed,
  applyLine, applyAnswered, applyOpened, applyCancelRequested, applyExit,
  normaliseCatalog, isCompatibleCatalog, takesArgs, takesManyArgs, buildDevenvArgv, devenvCommandKey,
  normaliseStatus, createPlanForm, validatePlanForm, buildPlanAnswer, normaliseRefPrompt, normaliseSummary,
  normaliseBuilds, buildBuildArgv, DEVENV_MOBILE_ABIS, DEVENV_DEPLOY_MODES,
  normaliseLogTargets, classifyLogLevel, filterLogLines, captureFolder, DEVENV_CAPTURE_SINCE,
  normaliseTestRuns, normaliseTestCollection, buildTestUpArgv, buildTestRunArgv, topLevelPaths,
  normaliseBaselines, normaliseSqlScripts, buildDbArgv, DEVENV_DB_EDITOR_URL,
  normaliseAvds, buildEmulatorArgv,
  normaliseMacStatus, buildMacArgv, macConnectionText,
  profileFileKind, validateProfileFile, validateEnvironment, validateMac, detectEol, toLf, fromLf, formatJson,
  setIn, newRepository, addRepository, renameRepository, removeRepository, REPOSITORY_KEY,
} from './modules/devenv/index.js'
export {
  getGitAdapter, GIT_AREAS, parseStatus, parseWorktrees, parseBranches, statusCode,
  worktreeId, worktreeName, activeBranchRef, branchLabel, checkoutName,
  loadSnapshot, refreshRepos, applyStatus, worktreeSummary, sourceName,
  ALL_PROJECTS, LEGACY_ALL_PROJECTS, findGroup, groupIncludesWorktree, groupIncludesBranch, scopeSnapshot, changeCount,
  uniqueName, groupNameError, renameGroup, duplicateGroup, deleteGroup, registerRepo, unregisterRepo,
  GroupDraft,
  parseDiff, diffSides, changePaths, isSubmodule, FILE_ACTIONS, actionsFor, groupChanges, toggleSelection, rangeSelection, pruneSelection,
  fileReview, commitTargets, commitReview, COMMIT_NOTE,
  parseRefs, parseLog, graphCells, parseSearch, historyQuery, HISTORY_STEP, HISTORY_MAX, parseRefList, defaultBase, parseAliases, parseShellAliases, parseShellScripts, parseCommitDetails, parseNameStatus, parseNumstat, parentLabel,
  ACTION_KINDS, BATCH_KINDS, BATCH_NOTE, actionTargets, previewModel, worktreeDefaultPath, checkBranchName, REBASE_ACTIONS, rebasePlan, moveRow, setRowAction, setRowMessage, rebaseTodo, squashGroups, rebaseMessages, messageRows, rebaseProblems, ACTIVITY_MAX, addActivity, failedTargets, filterFiles,
  parseConflicts, resolveRegion, hasMarkers, conflictKind, conflictLabels, operationText,
  wordMatch, filterByWords, filterFilesByWords,
  BRANCH_FILTERS, branchState, matchesFilter, filterCounts, branchMeta, commitsOff, repoPills, primaryAction,
  rewordProblem, squashPreviousProblem, squashSelectedProblem, editPlan, squashMessage,
} from './modules/git/index.js'
