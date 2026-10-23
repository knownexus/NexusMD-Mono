import { describe, it, expect } from 'vitest'
import * as core from '../src/index.js'

// Guardrail: the public API surface is a contract. Adding exports is fine (update
// this list in the same commit); removing/renaming one is a breaking change that
// must be a deliberate major-version bump, not an accident. This snapshot makes
// any change to the surface fail loudly in review.
const EXPECTED = [
  'BUNDLE_EXT', 'BUNDLE_FORMAT', 'BUNDLE_FORMAT_ENC', 'BUNDLE_VERSION',
  'encodeBundle', 'decodeBundle', 'planProfileScopeMigration',
  'stableStringify', 'contentHash',
  'mergeRows', 'mergeKeyVal', 'mergeText', 'mergeSet', 'mergePlannerWeek', 'reconcileItem',
  'encryptSync', 'decryptSync', 'plannerCollection', 'notesCollection', 'teamCustomCollection',
  'teamRemovedCollection', 'tweaksCollection', 'createSyncRuntime', 'startAutoSync', 'singleFlight',
  'exportBundle', 'importBundle', 'createSyncController', 'graphFetch', 'graphJSON', 'graphList', 'makeGoogleDriveProvider', 'makeOneDriveProvider',
  'makeWorkItemTypeDefsStore', 'fetchWorkItemTypes', 'fetchProjectFieldTypes', 'fetchTypeFields',
  'fetchClassificationPaths', 'loadWorkItemTypeDefs', 'fieldBucket', 'fieldGroup', 'TYPE_LAYOUTS',
  'resolveTypeLayout', 'LINK_TYPES', 'buildFieldPatchOps', 'buildAttachmentRelationOps',
  'buildLinkRelationOps', 'submitNewWorkItem', 'makeAdoWorkItemSource', 'adoMoveToCategory', 'adoWorkItemUrl',
  'buildSnapshot', 'nextHiddenIds', 'refreshProviders', 'defaultCreateProvider',
  'CURRENT_PROFILE_VERSION', 'IAuthAdapter', 'IBadgeAdapter', 'IClipboardAdapter',
  'IDeepLinkAdapter', 'IFileAdapter', 'IHttpAdapter', 'ILifecycleAdapter',
  'INavigationAdapter', 'INetworkAdapter', 'INotificationAdapter', 'IPickerAdapter',
  'ISecureStorageAdapter', 'IShareAdapter', 'IStorageAdapter', 'IThemeAdapter',
  'ITrayAdapter', 'IUpdateAdapter', 'IScriptRunnerAdapter', 'IRawHttpAdapter',
  'PLANNER_SECTIONS', 'PL_GROUPS', 'PL_OPEN',
  'PL_PRIOS', 'PL_STATUSES', 'PROJECT_COLORS', 'STATES', 'activateProfile',
  'addManualColumn', 'adoStateToHelm', 'adoTypeToHelm', 'appendAuditEntry', 'buildAlertKey',
  'buildDigest', 'buildEmptyPlannerData', 'buildProfile', 'buildTriageCsv', 'core',
  'createNoOpAdapters', 'createProfile', 'createTimer', 'decryptConfidentialFromServer',
  'deleteProfile', 'deriveActivity',
  'derivePrSparkline', 'deriveProjects', 'deriveSprint', 'effectiveNeedsMe', 'effectiveTeamActivity',
  'elapsedMs', 'encryptConfidentialForServer',
  'filterFiles', 'wordMatch', 'filterByWords', 'filterFilesByWords',
  'BRANCH_FILTERS', 'branchState', 'matchesFilter', 'filterCounts', 'branchMeta', 'repoPills', 'primaryAction',
  'parseConflicts', 'resolveRegion', 'hasMarkers', 'conflictKind', 'conflictLabels', 'operationText',
  'enrichTeam', 'enrichTeamMember', 'exportProfile', 'fetchAdoProcessMetadata', 'filterTriageItems',
  'fmtDateShort', 'formatClock', 'formatDateTime', 'formatDuration', 'generateProfileId', 'getActiveLanes', 'getEventsForDay', 'getIsoWeek',
  'getIsoYearWeek', 'getMondayOfDate', 'getYearWeekForOffset',
  'hasMeaningfulPlannerData', 'hashPassword', 'importProfile', 'initCore', 'isActiveState',
  'isAllDayEvent', 'isBlockedState', 'isExpired', 'isReviewState', 'isTerminalState',
  'lapTimer', 'listProfiles', 'loadAdoData', 'loadCachedAdoData', 'makeAdoConfig', 'ADO_CACHE_KEY',
  'removeAutoAdded', 'resetToDetected', 'resetTimer', 'reorderColumns', 'syncBoardColumns', 'toggleColumnHidden',
  'indexPRsByWorkItem', 'makeProfileKeys', 'mapBuild', 'mapBuildTimeline', 'mapPR', 'mapTestBuild', 'mapWorkItem',
  'mergeTeamRoster', 'pauseTimer', 'pendingAlerts', 'plFmtYmd', 'plIsOverdueYmd', 'plIsTodayYmd',
  'plParseYmd', 'plSectionGroup', 'plTodayDate', 'qaParseDue', 'readAuditLog',
  'registerModule', 'remainingMs', 'resumeTimer', 'slugify', 'sortEventsByTime', 'startTimer', 'stateCategory', 'stopTimer', 'timeAgo',
  'validateProfile', 'weekKeyToOffset', 'weekStorageKey',
  // Field/column visibility catalogs + resolver (configurable cards & tables)
  'WI_CARD_FIELDS', 'WI_TABLE_COLUMNS', 'PR_CARD_FIELDS', 'BUILDS_TABLE_COLUMNS', 'TESTS_TABLE_COLUMNS',
  'defaultConfig', 'resolveFields', 'reorderField', 'toggleField',
  // Shared PR REST helpers (threads/comments/resolve/reopen/commits/file changes/description)
  'fetchPRThreads', 'postPRThread', 'postPRReply', 'setPRThreadStatus',
  'fetchPRCommits', 'fetchPRFileChanges', 'fetchFileContent', 'updatePRDescription',
  // API client module (collections/requests/environments + var resolution)
  'getApiClientAdapters',
  'createCollection', 'readCollectionMeta', 'writeCollectionMeta',
  'listRequestIds', 'readRequest', 'writeRequest', 'deleteRequest',
  'listEnvironmentNames', 'readEnvironment', 'writeEnvironment', 'deleteEnvironment',
  'loadCollection', 'addTreeNode', 'removeTreeNode', 'findTreeNode', 'flattenRequestRefs',
  'resolveVars', 'resolveObjectVars', 'resolveEnvironment',
  'secretStorageKey', 'setSecretVar', 'removeSecretVar',
  'buildRequest', 'executeRequest',
  'buildRunEntries', 'runCollection',
  'importPostmanCollection',
  'appendHistoryEntry', 'readHistory', 'clearHistory',
  // Database Manager module (desktop-only: requires the `dbManager` adapter)
  'IDbManagerAdapter', 'getDbManagerAdapter', 'parseConnectionString', 'buildConfig',
  'resolveConnectionParams', 'buildConnectionString', 'SQL_AUTH', 'AZURE_AD_INTERACTIVE', 'connectionStringToFields', 'createInitialState', 'applyConnected', 'applyDisconnected',
  'applyTableSelected', 'applyTableLoaded', 'applyRowsDeleted', 'applyCellUpdated', 'applyError',
  'generateConnectionId', 'upsertConnection', 'removeConnection',
  'normalizeTablePrefs', 'toggleTableStarred', 'toggleTableHidden', 'setTableGroup', 'renameTableGroup',
  'removeTableGroup', 'toggleSectionCollapsed', 'tableSections', 'groupSectionKey', 'schemaSectionKey',
  'columnKind', 'isPartialInput', 'cellToInput', 'parseCellInput',
  // Dev Environment module (desktop-only: requires the `devenv` adapter)
  'IDevenvAdapter', 'getDevenvAdapter', 'DEVENV_CONTROL_PREFIX', 'DEVENV_PROTOCOL_VERSION', 'parseDevenvLine',
  'ansiToSpans', 'stripAnsi',
  'DEVENV_MAX_LINES', 'createRunState', 'applyStarting', 'applyStarted', 'applyStartFailed',
  'applyLine', 'applyAnswered', 'applyOpened', 'applyCancelRequested', 'applyExit',
  'normaliseCatalog', 'isCompatibleCatalog', 'takesArgs', 'takesManyArgs', 'buildDevenvArgv', 'devenvCommandKey',
  'normaliseStatus', 'createPlanForm', 'validatePlanForm', 'buildPlanAnswer', 'normaliseRefPrompt', 'normaliseSummary',
  'normaliseBuilds', 'buildBuildArgv', 'DEVENV_MOBILE_ABIS', 'DEVENV_DEPLOY_MODES',
  'normaliseLogTargets', 'classifyLogLevel', 'filterLogLines', 'captureFolder', 'DEVENV_CAPTURE_SINCE',
  'normaliseTestRuns', 'normaliseTestCollection', 'buildTestUpArgv', 'buildTestRunArgv', 'topLevelPaths',
  'normaliseBaselines', 'normaliseSqlScripts', 'buildDbArgv', 'DEVENV_DB_EDITOR_URL',
  'normaliseAvds', 'buildEmulatorArgv',
  'normaliseMacStatus', 'buildMacArgv', 'macConnectionText',
  'profileFileKind', 'validateProfileFile', 'validateEnvironment', 'validateMac', 'detectEol', 'toLf', 'fromLf', 'formatJson',
  'setIn', 'newRepository', 'addRepository', 'renameRepository', 'removeRepository', 'REPOSITORY_KEY',
  // Git Workspace module (desktop-only: requires the `git` adapter)
  'IGitAdapter', 'getGitAdapter', 'GIT_AREAS', 'parseStatus', 'parseWorktrees', 'parseBranches', 'statusCode',
  'worktreeId', 'worktreeName', 'activeBranchRef', 'branchLabel', 'checkoutName', 'loadSnapshot', 'refreshRepos', 'applyStatus', 'worktreeSummary',
  'ALL_PROJECTS', 'LEGACY_ALL_PROJECTS', 'findGroup', 'groupIncludesWorktree', 'groupIncludesBranch', 'scopeSnapshot', 'changeCount',
  'uniqueName', 'groupNameError', 'renameGroup', 'duplicateGroup', 'deleteGroup', 'registerRepo', 'unregisterRepo',
  'GroupDraft',
  'parseDiff', 'diffSides', 'changePaths', 'isSubmodule', 'FILE_ACTIONS', 'actionsFor', 'groupChanges',
  'toggleSelection', 'rangeSelection', 'pruneSelection', 'fileReview', 'commitTargets', 'commitReview', 'COMMIT_NOTE',
  'parseRefs', 'parseLog', 'graphCells', 'parseSearch', 'historyQuery', 'HISTORY_STEP', 'HISTORY_MAX', 'parseRefList', 'defaultBase', 'parseAliases', 'parseShellAliases', 'parseShellScripts', 'parseCommitDetails', 'parseNameStatus', 'parseNumstat', 'parentLabel',
  'ACTION_KINDS', 'BATCH_KINDS', 'BATCH_NOTE', 'actionTargets', 'previewModel', 'worktreeDefaultPath', 'checkBranchName', 'REBASE_ACTIONS', 'rebasePlan', 'moveRow', 'setRowAction', 'setRowMessage', 'rebaseTodo', 'squashGroups', 'rebaseMessages', 'messageRows', 'rebaseProblems', 'ACTIVITY_MAX', 'addActivity', 'failedTargets',
  'formatSqlValue', 'formatCondition', 'quoteIdent',
  'buildSearchQuery', 'buildInsertQuery', 'buildUpdateQuery', 'buildDeleteQuery',
  'buildJoinQuery', 'buildAggregateQuery',
  // Work items module (ADO + Jira merged)
  'JIRA_ID_PREFIX', 'isJiraId', 'toJiraId', 'jiraKeyFromId', 'sourceOfId', 'displayIdOf',
  'CATEGORY_LANES', 'CATEGORY_LABELS', 'itemCategory', 'adoStateForCategory',
  'WORK_ITEM_STATUS_KEY', 'readProviderStatus', 'recordProviderStatus', 'describeProviderError',
  'PROVIDER_LABELS', 'mergeTeam', 'mergeWorkItemData', 'applyHiddenPeople',
  'isDoneItem', 'isBlockedItem', 'isReviewItem', 'isActiveItem',
  // Jira module
  'normaliseSite', 'makeJiraConfig', 'makeJiraClient', 'JiraError', 'jiraErrorMessage',
  'htmlToAdf',
  'JIRA_CATEGORY_MAP', 'categoryOfJiraStatus', 'discoverFieldIds', 'fetchJiraMetadata', 'fillMetadataFromIssues', 'emptyJiraMeta',
  'mapJiraIssue', 'mapResolvedJiraIssue', 'pickSprint',
  'JIRA_CACHE_KEY', 'JIRA_BASE_FIELDS', 'buildActiveJql', 'buildResolvedJql', 'searchAllIssues', 'loadJiraData', 'loadCachedJiraData',
  'loadJiraDetail', 'loadJiraComments', 'addJiraComment', 'loadJiraRawFields', 'buildJiraFieldsPayload',
  'updateJiraIssue', 'listJiraTransitions', 'pickTransition', 'transitionJiraIssue', 'transitionJiraIssueToAny', 'jiraPatchFromAdoField',
  'classifyJiraField', 'normaliseCreateFields', 'layoutCreateFields', 'buildJiraCreatePayload',
  'fetchJiraCreateTypes', 'fetchJiraCreateFields', 'fetchJiraLinkTypes', 'createJiraIssue',
  'fetchJiraBoards', 'fetchJiraBoardColumns', 'fetchJiraBoardConfig', 'jiraColumnForStatus',
].sort()

describe('public API surface', () => {
  it('exports exactly the documented set of names', () => {
    expect(Object.keys(core).sort()).toEqual(EXPECTED)
  })

  it('core must stay headless — no React/DOM/storage imports leak through', () => {
    // Every export is data/logic, never a live DOM/React object.
    for (const [name, value] of Object.entries(core)) {
      expect(value, `${name} should not be a DOM node`).not.toHaveProperty('nodeType')
    }
  })
})
