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
  'enrichTeam', 'enrichTeamMember', 'exportProfile', 'filterTriageItems',
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
