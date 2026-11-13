import React from 'react'
import { createPortal } from 'react-dom'
import {
  isTerminalState, newWidgetsAfterSave, readLists, getYearWeekForOffset, widgetPage, linkPage, resolveLink, githubRepoOf, savedDocIds,
  ignore, rendererLog,
} from '@nexusmd/core'
import {
  WidgetSheet, Sheet, Icon, WIDGET_TYPES, storageTimerStore, useNexusData, useEffectiveNeedsMe, useProfile,
  loadWeekPlanner, toast,
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

const log = rendererLog('work', 'home-widgets')

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
// A File-or-folder shortcut opens through the capabilities its app offers (git.openPath, editor.openPath, documents.openDoc), as apps
// never import each other. A shortcut to a repository is shown whenever Git Workspace is installed, even though the
// Repo widget (page 'git') is not offered: it is found among the registered repositories by its remote.
const PLATFORM = 'desktop'
// The saved documents of each tool, in the profile's own stores (the ones the Documents screen reads).
const savedDocs = () => ({
  markdown: savedDocIds(localStorage.getItem(getProfileKey('md_documents'))),
  json: savedDocIds(localStorage.getItem(getProfileKey('json_editor_documents'))),
})
const GIT_PAGE_APP = 'git'

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
  cards = NO_CARDS, hidden = NO_CARDS, widgetWidths = NO_SIZES, widgetHeights = NO_SIZES, gridWidth,
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

  // The registered repositories (with their remotes), asked of Git Workspace only when a shortcut needs them. null until known.
  const caps = host?.capabilities
  const wantsRepos = widgets.some(w => w?.type === 'link' && linkPage(w.config) === 'git') && !!caps?.has?.('git.listRepos')
  const [repos, setRepos] = React.useState(null)
  React.useEffect(() => {
    if (!wantsRepos) return undefined
    let live = true
    Promise.resolve().then(() => caps.call('git.listRepos'))
      .then(r => { if (live) setRepos(Array.isArray(r) ? r : []) })
      .catch(e => {
        ignore(log, 'Git Workspace could not list its repositories, so a repository shortcut has none to match', e, 'warn')
        if (live) setRepos([])
      })
    return () => { live = false }
  }, [wantsRepos, caps, stamp, profileId])

  // Whether this desktop can open a shortcut, and how: a repository that is not registered here can still be shown
  // on the GitHub tab when it is on GitHub.
  const resolveTarget = t => {
    if (t.target === 'git') {
      if (!caps?.has?.('git.openPath')) return { ok: false, reason: 'Git Workspace is not installed.' }
      if (repos === null) return { ok: true }
      const hit = resolveLink(t, { repos })
      return hit.ok || githubRepoOf(t.repo) ? { ok: true } : hit
    }
    if (t.target === 'editor') {
      if (!caps?.has?.('editor.openPath')) return { ok: false, reason: 'The Editor is not installed.' }
      return resolveLink(t, { platform: PLATFORM })
    }
    if (!caps?.has?.('documents.openDoc')) return { ok: false, reason: 'Documents is not installed.' }
    return resolveLink(t, { docs: savedDocs(), platform: PLATFORM })
  }
  const openTarget = async t => {
    try {
      if (t.target === 'git') {
        const hit = resolveLink(t, { repos: repos || [] })
        const spec = { path: t.path, kind: t.kind, ...(t.branch ? { branch: t.branch } : {}) }
        if (hit.ok) spec.repoPath = hit.repo.path
        const github = githubRepoOf(t.repo)
        if (github) spec.githubRepo = github
        if (!spec.repoPath && !spec.githubRepo) { toast(hit.reason, 'error'); return }
        await caps.call('git.openPath', spec)
      } else if (t.target === 'editor') {
        // The Editor shows the file and goes to it; a path that is gone is said here, where the click was.
        if (!(await caps.call('editor.openPath', t.path))) toast(`${t.name || t.path} no longer exists.`, 'error')
      } else if (t.target === 'doc') {
        if (!(await caps.call('documents.openDoc', { tool: t.tool, docId: t.docId }))) toast(`${t.name || 'That document'} no longer exists.`, 'error')
      }
    } catch (e) {
      log.warn('a Home shortcut could not be opened', e)
      toast(e?.message || 'Could not open that.', 'error')
    }
  }

  const ctx = {
    navTo, onOpenPR: openPR, onOpenItem: openItem, isTerminalState, openTarget, resolveTarget,
    needsMe: p => effectiveNeedsMe(p, needsMeCriteria),
    prs: data.PRS || [], builds: data.BUILDS || [], tests: data.TESTS || [], workItems: data.WORK_ITEMS || [],
    me: data.ME?.id, team, lists, plannerData, timer,
    // notes: the shared default (loadGlobalNotes/saveGlobalNotes), which is what the Notes app uses.
  }

  const gitInstalled = !!host?.isInstalled?.(GIT_PAGE_APP)
  const isOff = w => (w.type === 'link' && linkPage(w.config) === 'git' ? !gitInstalled : offScreens.includes(widgetPage(w)))
  const shown = widgets.filter(w => w && WIDGET_TYPES[w.type] && !isOff(w))

  // Until the screen is known, nothing is placed (so no layout is drawn for the wrong screen).
  return (
    <div style={{ marginTop: 16 }}>
      {display && (
        <DashboardGrid cards={cards} widgets={shown} widgetTypes={WIDGET_TYPES} ctx={ctx} onEdit={w => setSheet({ widget: w })}
          display={display} layouts={tweaks.dashLayouts || {}} onLayoutsChange={next => setTweak?.('dashLayouts', next)}
          widgetWidths={widgetWidths} widgetHeights={widgetHeights} width={gridWidth} hidden={hidden}
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
