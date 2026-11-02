import React from 'react'
import { createPortal } from 'react-dom'
import {
  isTerminalState, newWidgetsAfterSave, readLists, getYearWeekForOffset,
} from '@nexusmd/core'
import {
  WidgetSheet, Sheet, Icon, WIDGET_TYPES, storageTimerStore, useNexusData, useEffectiveNeedsMe, useProfile,
  loadWeekPlanner,
} from '@nexusmd/ui'
import { getProfileKey } from '@nexusmd/shell-sdk'
import { useWork } from './work-context.js'
import { useOffScreens } from './work-screens.js'
import { DashboardGrid, useDisplay } from './dashboard-grid.jsx'

// The desktop Dashboard's widget grid: DashboardView's built-in cards (`cards`) and the optional Home
// widgets, together in one grid (dashboard-grid.jsx) where each can be moved and resized, with a layout per
// screen (the `dashLayouts` tweak). The Home widgets and their sheet are shared with mobile (@nexusmd/ui);
// the chosen ones are the `homeWidgets` tweak and the `ctx` they read is built here from what the desktop
// holds. Widgets whose screen is switched off or not installed are neither shown nor offered.

const DEFAULT_CRITERIA = { votes: [0], includeDrafts: false }
const NO_TEAM = []

// The widget catalogue's page ids (core WIDGET_PAGES) that are desktop apps of their own: page → app id.
const PAGE_APPS = {
  planner: 'planner', time: 'time', notes: 'notes', markdown: 'documents', api: 'api-client', editor: 'editor',
}
// Work's screen ids where the catalogue says something else.
const WORK_PAGE = { prs: 'pr' }
// The desktop's view ids where the catalogue says something else.
const DESKTOP_VIEW = { pr: 'prs', api: 'api-client' }
// Widgets the desktop has nothing real to fill with, so it never offers them:
//   calendar  the Calendar app keeps no events of its own on desktop (they are fetched from Outlook/Google
//             inside its screen), so "Today" would always be empty;
//   git       the Repo widget needs a repo list and a way to open one repo, which the desktop doesn't offer.
const NOT_ON_DESKTOP = ['calendar', 'git']

/** The catalogue pages to leave out: Work's switched-off screens, Lists outside manual profiles, apps that
 *  aren't installed, and the widgets with no desktop data. */
export function desktopOffPages({ workOff = [], listsHidden = false, isInstalled = () => true }) {
  const off = workOff.map(id => WORK_PAGE[id] || id)
  if (listsHidden) off.push('lists')
  for (const [page, app] of Object.entries(PAGE_APPS)) if (!isInstalled(app)) off.push(page)
  return [...new Set([...off, ...NOT_ON_DESKTOP])]
}

function navTo(page, filter) {
  window.dispatchEvent(new CustomEvent('nexusmd:navigate', { detail: { view: DESKTOP_VIEW[page] || page, filter: filter || null } }))
}

// The shared sheet in a full-window overlay: its veil fills the nearest positioned box, which on desktop
// is this one (see .m-sheet-overlay in @nexusmd/ui's mobile-parts.css), centred over the whole window.
function OverlaySheet(props) {
  if (!props.open) return null
  return createPortal(<div className="m-sheet-overlay"><Sheet {...props} /></div>, document.body)
}

const listsStore = () => ({ storage: localStorage, getProfileKey, namespace: 'nexusmd' })
function currentPlanner() {
  const { year, week } = getYearWeekForOffset(0)
  return loadWeekPlanner(year, week)?.data || {}
}

const NO_CARDS = []
const NO_SIZES = {}

export function HomeWidgets({
  host, tweaks = {}, setTweak, team = NO_TEAM, needsMeCriteria = DEFAULT_CRITERIA,
  cards = NO_CARDS, widgetWidths = NO_SIZES, widgetHeights = NO_SIZES, gridWidth,
}) {
  const { data = {} } = useNexusData() || {}
  const { openItem, openPR } = useWork()
  const effectiveNeedsMe = useEffectiveNeedsMe()
  const { activeProfile } = useProfile() || {}
  const workOff = useOffScreens()
  const [sheet, setSheet] = React.useState(null)
  const display = useDisplay(host)

  // Re-read what lives in storage when a sync pull lands, or the profile changes.
  const [stamp, setStamp] = React.useState(0)
  React.useEffect(() => {
    const onApplied = () => setStamp(n => n + 1)
    document.addEventListener('nexusmd:sync-applied', onApplied)
    return () => document.removeEventListener('nexusmd:sync-applied', onApplied)
  }, [])

  // Lists are a manual profile's (as in lists-view.jsx's useListsHidden).
  const listsHidden = activeProfile?.type !== 'manual'
  const offScreens = desktopOffPages({ workOff, listsHidden, isInstalled: id => !!host?.isInstalled?.(id) })

  // One store per profile: TimeWidget's ticking effect depends on it, so it must not change between renders.
  // The log is the Time screen's own (modules/time keeps it at nexusmd.timelog.v1).
  const logKey = getProfileKey('nexusmd.timelog.v1')
  const pausedKey = getProfileKey('nexusmd.dash.timePaused')
  const timer = React.useMemo(() => storageTimerStore({ storage: localStorage, logKey, pausedKey }), [logKey, pausedKey])

  // `stamp` and the profile are what make these worth reading again.
  const profileId = activeProfile?.id
  const lists = React.useMemo(() => readLists(listsStore()).lists, [stamp, profileId])
  const plannerOn = !offScreens.includes('planner')
  const plannerData = React.useMemo(() => (plannerOn ? currentPlanner() : {}), [stamp, profileId, plannerOn])

  const widgets = Array.isArray(tweaks.homeWidgets) ? tweaks.homeWidgets : []
  const save = next => setTweak?.('homeWidgets', next)
  const ctx = {
    navTo, onOpenPR: openPR, onOpenItem: openItem, isTerminalState,
    needsMe: p => effectiveNeedsMe(p, needsMeCriteria),
    prs: data.PRS || [], builds: data.BUILDS || [], tests: data.TESTS || [], workItems: data.WORK_ITEMS || [],
    me: data.ME?.id, team, lists, plannerData, timer,
    // notes: the shared default (loadGlobalNotes/saveGlobalNotes), which is what the Notes app uses.
  }

  const shown = widgets.filter(w => w && WIDGET_TYPES[w.type] && !offScreens.includes(WIDGET_TYPES[w.type].page))

  // Until the screen is known, nothing is placed (so no layout is drawn for the wrong screen).
  return (
    <div style={{ marginTop: 16 }}>
      {display && (
        <DashboardGrid cards={cards} widgets={shown} widgetTypes={WIDGET_TYPES} ctx={ctx} onEdit={w => setSheet({ widget: w })}
          display={display} layouts={tweaks.dashLayouts || {}} onLayoutsChange={next => setTweak?.('dashLayouts', next)}
          widgetWidths={widgetWidths} widgetHeights={widgetHeights} width={gridWidth}
          footer={(
            <button type="button" className="btn sm" onClick={() => setSheet({ widget: null })}>
              <Icon name="plus" size={13} /> Add widget
            </button>
          )} />
      )}
      <WidgetSheet open={!!sheet} widget={sheet?.widget || null} offScreens={offScreens} Sheet={OverlaySheet} showWidth={false}
        onClose={() => setSheet(null)}
        onSave={w => { save(newWidgetsAfterSave(widgets, w)); setSheet(null) }}
        onRemove={w => { save(widgets.filter(x => x.id !== w.id)); setSheet(null) }} />
    </div>
  )
}
