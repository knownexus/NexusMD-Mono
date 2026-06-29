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
  Avatar, TypeIcon, NotificationBanner, MenuButton, usePersisted, ProjectChip, Drawer,
} from './app-components.jsx'

// Cross-platform data seam consumed by the shared views.
export {
  NexusDataProvider, useNexusData, useEffectiveNeedsMe, EMPTY_NEXUS_DATA,
} from './data-context.jsx'

// Profile registry (active profile, CRUD, export/import). Each app wraps this
// with a platform `store` (web REST vs app local) in its own profile-context.
export { ProfileProvider, useProfile } from './profile-context.jsx'

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
  MicrosoftLogo, EventDetailModal, OutlookSetupModal, OutlookBanner,
  DayColumn, WeekGrid, MonthView, YearView, AgendaView,
} from './views/view-calendar.jsx'

// Shared Settings form/profile primitives (web + app). Each app keeps its own
// SettingsView page + integration cards; these are the shared building blocks.
export {
  PROFILE_COLORS,
  PlToggle, VsRow, VsCard, VsFullRow, ThemeChipPicker, VsSeg,
  VsPasswordModal, VsProfileEditor, VsProfiles,
} from './views/view-settings.jsx'

// Shared triage controls + work-item detail panel (used by the views below).
export { TriageEvents, TriageExportButton, TriageStatusLine, TriageExportModal } from './views/triage.jsx'
export { WorkItemDetail, RawFieldsInspector } from './views/work-item-detail.jsx'
export { MarkdownViewer, displayName } from './views/MarkdownViewer.jsx'

// Shared, platform-agnostic views (data + actions via props / useNexusData).
export { PRView } from './views/view-prs.jsx'
export { TestsView } from './views/view-tests.jsx'
export { BuildsView } from './views/view-builds.jsx'
export { TeamView } from './views/view-team.jsx'
export { TriageView, TriageRow } from './views/view-triage.jsx'
export { WorkItemsView } from './views/view-workitems.jsx'
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
