import React from 'react'
import { defaultCreateProvider, loadCachedGithubData } from '@nexusmd/core'
import { localStorageAdapter } from '@nexusmd/web-adapters'
import { NexusDataProvider, useSeenTracking, SEEN_FINGERPRINTS } from '@nexusmd/ui'
import { getProfileKey } from '@nexusmd/shell-sdk'
import { useLocalItems } from './items-state.js'
import { getAdoConfig, usesAdoWorkItems } from './ado-client.js'
import { getJiraConfig, isJiraActive, createJiraWorkItemSource } from './jira-client.js'
import { getGithubConfig, usesGithubWorkItems, isGithubConfigured, desktopGithubSource, createGithubHttpAdapter } from './github-client.js'
import { useRoutedWorkItemSource } from './use-routed-work-item-source.js'
import { desktopBuildSource } from './desktop-build-source.js'
import { CreateWorkItemDrawer } from './create-work-item-drawer.jsx'
import { DetailDrawer } from './detail-drawer.jsx'
import { ProjectAreasModal } from './project-areas-modal.jsx'
import { makeRefreshAllData, desktopWorkItemSource, useNexusSnapshot } from './work-data.js'
import { WorkContext } from './work-context.js'
import { workBadges } from './work-store.js'
import { useOffScreens, skippedFetches } from './work-screens.js'

// The drawer's reviewer list reads reviewerDetails, so a vote cast from the drawer is
// written there until the refreshed PR arrives.
function withMyVote(pr, myVote, snapshot) {
  const me = pr.source === 'github' ? snapshot.GITHUB_ME?.login : snapshot.ME?.name
  if (!me) return pr
  const list = pr.reviewerDetails || []
  const at = list.findIndex(r => (r.name || '').toLowerCase() === me.toLowerCase())
  const reviewerDetails = at >= 0
    ? list.map((r, i) => (i === at ? { ...r, vote: myVote } : r))
    : [...list, { id: me, name: me, vote: myVote }]
  return { ...pr, reviewerDetails }
}

const VIEW_TO_CATEGORY = { work: 'work', prs: 'pr', builds: 'builds', tests: 'tests' }
// GitHub PR drawer tabs read through this; it uses whichever token is saved at request time.
const githubHttp = createGithubHttpAdapter()

// Wraps the whole shell, above every screen, so what Work owns outlives leaving a screen: the
// cached data and its refresh, the unseen-item markers, and the drawers that open from any screen.
// `view` is the screen showing now (opening Work Items marks its items as seen).
export function WorkProvider({ host, view, children }) {
  const refreshAllData = React.useMemo(() => makeRefreshAllData(host.cloud), [host])

  const [drawer, setDrawer] = React.useState(null)
  const [createWI, setCreateWI] = React.useState(null)
  const [areasOpen, setAreasOpen] = React.useState(false)
  const [githubExpired, setGithubExpired] = React.useState(false)
  const openItem   = item => setDrawer({ kind: 'wi', data: item })
  const openPR     = pr   => setDrawer({ kind: 'pr', data: pr })
  const openPerson = dev  => setDrawer({ kind: 'person', data: dev })
  const openBuild  = b    => setDrawer({ kind: 'build', data: b })

  const [refreshInterval, setRefreshInterval] = React.useState(() => {
    try {
      const n = parseInt(localStorage.getItem('nexusmd.refreshInterval') || '300', 10)
      return Number.isFinite(n) && n > 0 ? n : 300
    } catch { return 300 }
  })
  const [refreshPaused, setRefreshPaused] = React.useState(false)
  const [refreshLeft, setRefreshLeft] = React.useState(refreshInterval)
  const refreshLeftRef = React.useRef(refreshInterval)

  const { snapshot, loaded: dataLoaded } = useNexusSnapshot()

  // What other apps (Git) may borrow: GitHub's credentials-backed client with Work's cached
  // data, and Work's drawers. Config and snapshot are read when called, not when registered.
  const snapshotRef = React.useRef(snapshot)
  snapshotRef.current = snapshot
  const drawersRef = React.useRef({})
  drawersRef.current = { openItem, openPR, openBuild }
  React.useEffect(() => {
    const caps = host.capabilities
    if (!caps?.provide) return undefined
    const offs = [
      caps.provide('work.github', () => {
        if (!isGithubConfigured()) return null
        const config = getGithubConfig()
        const snap = snapshotRef.current
        // Kept to the Git tab, issues and runs aren't in the snapshot: read GitHub's own cache.
        const own = config.inWork ? snap : (loadCachedGithubData(config, { storage: localStorageAdapter }) || {})
        return {
          repos: config.repos,
          http: githubHttp,
          inWork: config.inWork,
          cached: {
            prs: (snap.PRS || []).filter(p => p.source === 'github'),
            issues: (own.WORK_ITEMS || []).filter(i => i.source === 'github'),
            builds: (own.BUILDS || []).filter(b => b.source === 'github'),
          },
        }
      }),
      // The tickets other apps may track time against (the Time app's picker).
      caps.provide('work.items', () => (snapshotRef.current.WORK_ITEMS || []).map(i => ({
        id: String(i.key ?? i.id), title: i.title || '', source: i.source || 'ado',
      }))),
      caps.provide('work.openPR', pr => drawersRef.current.openPR(pr)),
      caps.provide('work.openItem', item => drawersRef.current.openItem(item)),
      caps.provide('work.openBuild', build => drawersRef.current.openBuild(build)),
    ]
    return () => offs.forEach(off => off())
  }, [host])

  // A refresh brings the provider's real state: show it in an open PR drawer.
  React.useEffect(() => {
    setDrawer(dr => {
      if (!dr || dr.kind !== 'pr') return dr
      const fresh = (snapshot.PRS || []).find(p => p.id === dr.data.id)
      return fresh && fresh !== dr.data ? { ...dr, data: fresh } : dr
    })
  }, [snapshot.PRS])

  // localItems starts as null (sentinel: mirror snapshot.WORK_ITEMS). Shared
  // views update via setItems(arr => arr.map(...)); the setter resolves the
  // sentinel to the current snapshot so the first edit doesn't call .map on null.
  // A new snapshot (refresh, hide/restore) resets it so Work Items shows it.
  const [localItems, setItemsResolved] = useLocalItems(snapshot)

  const seenCategories = {
    work:   { items: snapshot.WORK_ITEMS || [], fingerprint: SEEN_FINGERPRINTS.work },
    pr:     { items: snapshot.PRS || [],        fingerprint: SEEN_FINGERPRINTS.pr },
    builds: { items: snapshot.BUILDS || [],     fingerprint: SEEN_FINGERPRINTS.builds },
    tests:  { items: snapshot.TESTS || [],      fingerprint: SEEN_FINGERPRINTS.tests },
  }
  const { unseenIds: newItemIds, unseenCounts, markSeen } = useSeenTracking(
    seenCategories, dataLoaded, { storage: window.localStorage, getProfileKey },
  )

  // Sidebar badges are keyed by sidebar entry; 'prs' maps to the 'pr' category.
  React.useEffect(() => {
    workBadges.set({ work: unseenCounts.work, prs: unseenCounts.pr, builds: unseenCounts.builds, tests: unseenCounts.tests })
  }, [unseenCounts.work, unseenCounts.pr, unseenCounts.builds, unseenCounts.tests])

  React.useEffect(() => {
    const key = VIEW_TO_CATEGORY[view]
    if (key) markSeen(key)
  }, [view, snapshot])

  React.useEffect(() => {
    const handler = () => setGithubExpired(true)
    window.addEventListener('nexusmd:github-401', handler)
    return () => window.removeEventListener('nexusmd:github-401', handler)
  }, [])

  React.useEffect(() => {
    const handler = (e) => setCreateWI(e.detail || {})
    window.addEventListener('nexusmd:create-wi', handler)
    return () => window.removeEventListener('nexusmd:create-wi', handler)
  }, [])

  React.useEffect(() => {
    const handler = () => setAreasOpen(true)
    window.addEventListener('nexusmd:openProjectAreas', handler)
    return () => window.removeEventListener('nexusmd:openProjectAreas', handler)
  }, [])

  // F5 (main process menu accelerator) sends 'refresh-data' instead of reloading the window, so it
  // triggers the same data refresh as the in-app Refresh button rather than resetting navigation
  // state back to the first screen.
  React.useEffect(() => { host.adapters.windowControls?.onRefreshData(() => { refreshAllData() }) }, [host, refreshAllData])

  // Switching Pull Requests, Builds or Tests on or off changes what is fetched: refresh, so a screen
  // switched on gets its data now and one switched off lets go of it.
  const fetched = JSON.stringify(skippedFetches(useOffScreens()))
  const firstFetched = React.useRef(fetched)
  React.useEffect(() => {
    if (fetched === firstFetched.current) return
    firstFetched.current = fetched
    refreshAllData()
  }, [fetched, refreshAllData])

  React.useEffect(() => {
    refreshLeftRef.current = refreshInterval
    setRefreshLeft(refreshInterval)
  }, [refreshInterval])

  React.useEffect(() => {
    if (refreshPaused) return
    const tick = setInterval(() => {
      refreshLeftRef.current -= 1
      setRefreshLeft(refreshLeftRef.current)
      if (refreshLeftRef.current <= 0) {
        refreshAllData()
        refreshLeftRef.current = refreshInterval
        setRefreshLeft(refreshInterval)
      }
    }, 1000)
    return () => clearInterval(tick)
  }, [refreshPaused, refreshInterval, refreshAllData])

  // One Jira source per Jira-active state: a new identity on every snapshot
  // would make JiraCreateForm re-fetch create-meta and wipe the user's input.
  const jiraActive = isJiraActive()
  const jiraSource = React.useMemo(() => (jiraActive ? createJiraWorkItemSource() : null), [jiraActive])
  // GitHub issues are routed only while "Load GitHub issues" is on.
  const githubSource = usesGithubWorkItems() ? desktopGithubSource : null
  // Stable across data refreshes: only a Jira- or GitHub-source change produces a new identity.
  const workItemSource = useRoutedWorkItemSource(desktopWorkItemSource, jiraSource, githubSource)

  const nexusDataValue = React.useMemo(() => ({
    data:           snapshot,
    api:            { load: refreshAllData },
    storage:        window.localStorage,
    getProfileKey,
    pushPref:       () => {},
    workItemSource,
    buildSource:    desktopBuildSource,
    githubHttp,
  }), [snapshot, workItemSource, refreshAllData])

  const work = {
    refreshAllData, refreshInterval, setRefreshInterval, refreshLeft, refreshPaused, setRefreshPaused,
    githubExpired, dismissGithubExpired: () => setGithubExpired(false),
    newItemIds, localItems, setItems: setItemsResolved,
    openItem, openPR, openPerson, openBuild,
  }

  return (
    <NexusDataProvider value={nexusDataValue}>
      <WorkContext.Provider value={work}>
        {children}
        <DetailDrawer drawer={drawer} onClose={() => setDrawer(null)} setItems={setItemsResolved}
          onOpenItem={openItem} onOpenPR={openPR}
          onPRChanged={(id, patch) => {
            const { myVote, ...rest } = patch || {}
            setDrawer(dr => {
              if (!dr || dr.kind !== 'pr' || dr.data.id !== id) return dr
              const next = { ...dr.data, ...rest }
              return { ...dr, data: myVote == null ? next : withMyVote(next, myVote, snapshot) }
            })
            refreshAllData()
          }} />
        <CreateWorkItemDrawer
          open={!!createWI}
          title={createWI?.title}
          project={getAdoConfig().projects || []}
          team={snapshot.TEAM || []}
          adoAvailable={usesAdoWorkItems()}
          jira={jiraActive ? {
            source: jiraSource,
            projectKeys: getJiraConfig().projectKeys,
            people: snapshot.JIRA_PEOPLE || [],
            site: getJiraConfig().site,
          } : null}
          github={githubSource ? { source: githubSource, repos: getGithubConfig().repos } : null}
          defaultProvider={defaultCreateProvider({
            readJson: (k, d) => { try { const v = localStorage.getItem(getProfileKey(k)); return v == null ? d : JSON.parse(v) } catch { return d } },
            adoAvailable: usesAdoWorkItems(),
            jiraAvailable: jiraActive,
            githubAvailable: !!githubSource,
          })}
          onProviderChange={(p) => { try { localStorage.setItem(getProfileKey('nexusmd.wi.createProvider'), JSON.stringify(p)) } catch {} }}
          onJiraCreated={(result) => {
            if (!result.warnings?.length) setTimeout(() => setCreateWI(null), 600)
            refreshAllData()
          }}
          onGithubCreated={(result) => {
            if (!result.warnings?.length) setTimeout(() => setCreateWI(null), 600)
            refreshAllData()
          }}
          onClose={() => setCreateWI(null)}
          onCreate={async (payload) => {
            const result = await desktopWorkItemSource.createWorkItem(payload)
            if (result.warnings.length === 0) {
              setTimeout(() => setCreateWI(null), 600)
            }
            return result
          }}
        />
        <ProjectAreasModal open={areasOpen} onClose={() => setAreasOpen(false)} />
      </WorkContext.Provider>
    </NexusDataProvider>
  )
}
