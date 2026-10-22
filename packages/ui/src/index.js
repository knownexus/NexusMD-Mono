// @nexusmd/ui — shared React components + CSS for NexusMD platform apps.
//
// Depends on React (peer) and @nexusmd/core. Contains NO platform glue
// (electron/capacitor/DOM-storage); those live in each app's adapters.
//
// Stylesheet:  import '@nexusmd/ui/styles.css'

export { Icon } from './icons.jsx'
export {
  StatusChip, PrioChip, PlModal, PlFld, DueLabel,
} from './planner-chips.jsx'
export {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Ring, SortHeader, StatusSelect,
} from './components.jsx'

// Data-driven, app-coupled components (resolve team/storage via context).
export {
  Avatar, TypeIcon, NotificationBanner, MenuButton, usePersisted, useSeenTracking,
  SEEN_FINGERPRINTS, ProjectChip, Drawer, Sheet,
} from './app-components.jsx'

// Timer / stopwatch — hook + standalone widget (built on @nexusmd/core timer).
export { useTimer, useStopwatch } from './use-timer.js'
export { TimerWidget } from './timer-widget.jsx'

// Cross-platform data seam consumed by the shared views.
export {
  NexusDataProvider, useNexusData, useEffectiveNeedsMe, EMPTY_NEXUS_DATA,
} from './data-context.jsx'

// API client module seam (file/scriptRunner/secureStorage/apiHttp adapters) + view.
export { ApiClientProvider, useApiClient } from './api-client-context.jsx'
export { ApiClientView } from './views/view-api-client.jsx'
export { ViewDbManager } from './views/ViewDbManager.jsx'

// Profile registry (active profile, CRUD, export/import). Each app wraps this
// with a platform `store` (web REST vs app local) in its own profile-context.
export { ProfileProvider, useProfile, localUpsertProfiles } from './profile-context.jsx'

// Cloud-sync provider factories (Google Drive / OneDrive) for profile bundles.
export { makeGoogleDriveProvider, makeOneDriveProvider } from './cloud/providers.js'

// Global toast notifications.
export { toast, ToastHost, NexusMDToastBus } from './toast.jsx'

// Tweaks panel (edit-mode shell + form controls).
export {
  useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider, TweakToggle,
  TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton,
} from './tweaks-panel.jsx'

// Shared calendar layer (web + app). Each app keeps its own CalendarView
// orchestrator (desktop page-head vs mobile m-appbar; Google is web-only) and
// composes these pieces.
export {
  OutlookService,
  CAL_START_HOUR, CAL_END_HOUR, CAL_PX_PER_HOUR, CAL_TIME_W, EVENT_CFG,
  getWeekDays, getMonthGrid, getMiniMonth, getYearMonths, getAgendaDays,
  eventTopPx, eventHeightPx, nowTopPx, fmt12, fmtDuration, isoDate, todayStr,
  snapTime, formatLocalISO, layoutDayEvents, MONTH_NAMES, MONTH_SHORT, DAY_SHORT,
  MicrosoftLogo, EventDetailModal, OutlookBanner,
  WeekGrid, MonthView, YearView, AgendaView,
} from './views/view-calendar.jsx'

// Shared Settings form/profile primitives (web + app). Each app keeps its own
// SettingsView page + integration cards; these are the shared building blocks.
export {
  PROFILE_COLORS,
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg,
  VsPasswordModal, VsProfileEditor, VsProfiles,
  BundlePasswordModal, BackupRestoreCard, CloudPickerModal, CloudSyncCard,
  OAuthServiceCard, IntegrationsView, BoardColumnsCard, FieldVisibilityCard,
  CardsAndTablesSettings,
} from './views/view-settings.jsx'

// Shared triage controls + work-item detail panel (used by the views below).
export { TriageEvents, TriageExportButton, TriageStatusLine, TriageExportModal } from './views/triage.jsx'
export { WorkItemDetail, WorkItemFieldsEditor, RawFieldsInspector } from './views/work-item-detail.jsx'
export { createRoutedWorkItemSource } from './views/work-item-source.js'
export { apiBuildSource } from './views/build-source.js'
export { BuildDetail } from './views/build-detail.jsx'
export { TagInput, AreaTreePicker } from './views/wi-field-pickers.jsx'
export { PRTabs, PRCommitsTab, PRFilesTab } from './views/pr-tabs.jsx'
export { DEFAULT_PROJECT_AREAS, useProjectAreas } from './project-areas.js'
export { renderContent, mdToHtml } from './views/render-content.js'
export { MarkdownViewer, displayName } from './views/MarkdownViewer.jsx'
export { JsonEditorView } from './views/view-json-editor.jsx'
export { RegexTesterView } from './views/view-regex-tester.jsx'
export { DocumentsView } from './views/view-documents.jsx'

// Shared, platform-agnostic views (data + actions via props / useNexusData).
export { PRView } from './views/view-prs.jsx'
export { TestsView } from './views/view-tests.jsx'
export { BuildsView, ColHead } from './views/view-builds.jsx'
export {
  TeamView, slugifyLocal, getInitials, NoteModal, ScheduleOneOnOneModal,
} from './views/view-team.jsx'
export {
  TriageView, TriageRow, TriageKpi, TriageEditField, softBg,
  BUCKET_META, BUCKET_ORDER, PRIO_COLOR, AREA_OPTIONS, STATUS_OPTIONS,
} from './views/view-triage.jsx'
export { WorkItemsView, WorkItemIdLink, WI_TYPE_STATES_CACHE_KEY } from './views/view-workitems.jsx'
export { DashboardView } from './views/view-dashboard.jsx'

// Planner v2 subsystem (shared web + app). Chips (StatusChip/PrioChip/PlModal/
// PlFld/DueLabel) are exported above via planner-chips; here we add the planner
// constants, input primitives, notes, editors and glance.
export {
  PL_STATUSES, PL_PRIOS, PL_OPEN,
  plTodayDate, plParseYmd, plFmtYmd, plIsOverdueYmd, plIsTodayYmd, qaParseDue,
  PlannerDatePicker, PlannerDateTimePicker, ColInput, qaParse, plNewRow, plScrollToEl,
} from './planner/primitives.jsx'
export {
  plMdToHtml, plRowNotes, plOpenCtx, WorkItemCtxLayer, NotesEditor,
  RowNotesModal, NotesButton, loadGlobalNotes, saveGlobalNotes, GlobalNoteModal, GlobalNotesView,
} from './planner/planner-notes.jsx'
export {
  LockRowControls, HintControl, ReminderControl, LockedRowNotice,
  InlineTable, QuickAddList, DrawerTable, ThemesGrid, EowGrid, SectionCard,
} from './planner/planner-editors.jsx'
export {
  glanceCollect, GlanceStat, GlanceView, collectCarryItems, CarryOverModal,
} from './planner/planner-glance.jsx'
export { collectRowNotes, promoteRowNoteToLibrary, PlannerNotesPanel } from './planner/planner-notes-overview.jsx'
export {
  hashPassword, encryptConfidentialForServer, decryptConfidentialFromServer,
  loadConfidentialConfig, saveConfidentialConfig,
} from './planner/planner-confidential.js'
export {
  loadVersions, saveVersions, describeSnapshot,
  ImportModal, VersionsModal, ConfidentialSetPasswordModal, ConfidentialUnlockModal,
  WeekCalendarPicker, PlHeaderMenu, PlMenuItem, PlMenuRadio, DeleteWeekModal,
} from './planner/planner-modals.jsx'
export {
  loadWeekPlanner, saveWeekPlanner, deleteWeekPlanner, getWeeksWithData,
  isLegacyMigrationDone, markLegacyMigrationDone, checkConfidentialReminders,
} from './planner/planner-storage.js'
export { plannerExportDocx } from './planner/docx.js'
export { PlannerView } from './views/view-planner.jsx'

// App-shell pieces shared by the web and app hosts.
export { ProjectAreasModal } from './views/project-areas-modal.jsx'
export {
  SettField, SetupScreen, LoadingScreen, ProfileMenu, WidgetOrderEditor, Mini,
} from './views/shell-parts.jsx'
export {
  CreateWIModal, WIDetail, PersonDetail, DetailDrawer,
  DataTagInput, DataAreaTreePicker,
  DEFAULT_WI_TYPES, DEFAULT_PRIORITIES, PRIORITY_LABELS, settInputStyle,
} from './views/work-item-shell.jsx'
