import React from 'react'
import ReactDOM from 'react-dom/client'
import '@nexusmd/ui/styles.css'

import { initCore, createNoOpAdapters } from '@nexusmd/core'
import {
  Icon, CardFrame, NexusDataProvider, ToastHost,
  TweaksPanel, TweakSection, TweakRadio, TweakToggle, TweakButton,
  THEME_MODES, paletteFor,
} from '@nexusmd/ui'
import { isBareStandalone, effectiveSidebar, ICON_RAIL_WIDTH, visibleNav, SIDEBAR_BREAKPOINT, toggledSidebar, mountedViews } from './layout.js'
import { DesktopSettings } from './desktop-settings.jsx'
import { ProfileProvider, ensureDefaultProfileAndMigrate } from './profile-context.jsx'
import { getProfileKey, usePersistedState } from '@nexusmd/shell-sdk'
import { redeem } from './cloud-auth.js'
import { registerDeepLinks } from './shell/deep-links.js'
import { startDesktopAutoSync } from './sync.js'
import { INSTALLED_NAV, SETTINGS_NAV, ALL_NAV, DEFAULT_NAV_ORDER } from './nav-config.js'
import { isUninstalledView, registry, resolveView } from './shell/registry.js'
import {
  localStorageAdapter, networkAdapter, lifecycleAdapter, themeAdapter,
  clipboardAdapter, shareAdapter, notificationAdapter,
} from '@nexusmd/web-adapters'
import { windowControlsAdapter } from './adapters/windowControls.js'
import { navigationAdapter }    from './adapters/navigation.js'
import { authAdapter }          from './adapters/auth.js'
import { fileAdapter }          from './adapters/file.js'
import { pickerAdapter }        from './adapters/picker.js'
import { badgeAdapter }         from './adapters/badge.js'
import { trayAdapter }          from './adapters/tray.js'
import { deepLinkAdapter }      from './adapters/deepLink.js'
import { updateAdapter }        from './adapters/update.js'
import { secureStorageAdapter } from './adapters/secureStorage.js'
import {
  moduleAdapters, moduleView, findPopout, ModuleProviders, useModuleBadges, useModuleOffViews, ModuleTopbar, ModuleBanners,
} from './shell/modules.js'
import { host, takeWaitingNavigation } from './shell/host.js'
import { AppUpdatesBanner } from './app-updates.jsx'

const adapters = {
  ...createNoOpAdapters(),
  storage:       localStorageAdapter,
  network:       networkAdapter,
  lifecycle:     lifecycleAdapter,
  theme:         themeAdapter,
  clipboard:     clipboardAdapter,
  share:         shareAdapter,
  notification:  notificationAdapter,
  navigation:    navigationAdapter,
  auth:          authAdapter,
  file:          fileAdapter,
  picker:        pickerAdapter,
  badge:         badgeAdapter,
  tray:          trayAdapter,
  deepLink:      deepLinkAdapter,
  update:        updateAdapter,
  secureStorage: secureStorageAdapter,
  // Adapters the installed apps bring (e.g. git, devenv, dbManager, scriptRunner: they run in the main process and gate their core modules).
  ...moduleAdapters(),
}

const DASH_WIDGET_ORDER = ['sprint', 'review', 'blockers', 'team', 'triage', 'activity', 'resolvedme']

const DEFAULT_TWEAKS = {
  theme: 'light', lightTheme: 'parchment', dimTheme: 'umber', darkTheme: 'cobalt',
  density: 'balanced', sidebar: 'labels', typeLabels: false,
  widgetOrder: DASH_WIDGET_ORDER,
  navOrder: DEFAULT_NAV_ORDER,
  navHidden: [],
  quickLinks: [
    { label: 'UAT Testing', url: 'https://uat.example.com/', color: 'var(--info)' },
    { label: 'Dev Testing', url: 'https://dev.example.com/', color: 'var(--success)' },
    { label: 'Cirrus HR',   url: 'https://cirrushr.co.uk',        color: 'var(--violet)' },
  ],
}

function loadTweaks() {
  try { const s = localStorage.getItem('nexusmd.tweaks'); return s ? { ...DEFAULT_TWEAKS, ...JSON.parse(s) } : DEFAULT_TWEAKS } catch { return DEFAULT_TWEAKS }
}

// Seed a default profile and fold any pre-registry flat `nexusmd.*` data into
// its scope. Must run before initCore, which reads cached ADO data via the
// (now profile-scoped) getProfileKey.
ensureDefaultProfileAndMigrate()

// nexusmd:// deep links: open a screen, or redeem a cloud OAuth one-time code.
registerDeepLinks({ redeem, navigate: view => host.navigate(view) })

// Fire-and-forget: enables modules + inits adapters. The shell reads cached data
// and re-renders on core's 'data:updated' events.
initCore(adapters)

function Placeholder({ label }) {
  return (
    <CardFrame title={label}>
      <p style={{ color: 'var(--text-muted)' }}>
        {label} is platform-specific (it depends on the web host's APIs / Google) and is not
        shared into <code>@nexusmd/ui</code> yet.
      </p>
    </CardFrame>
  )
}

// The base data provider: what apps that don't bring their own data (the Planner, for one) still read
// from it, namely the profile-scoped storage. Work's provider replaces it with the real data.
const BASE_DATA = { storage: window.localStorage, getProfileKey, pushPref: () => {} }

// The body of a screen: an installed app's own view, or the shell's Settings.
function ViewBody({ view, tweaks = DEFAULT_TWEAKS, setTweak = () => {} }) {
  // A view from an app that isn't installed on this machine (stale saved view, deep link, tray).
  if (isUninstalledView(view)) return <Placeholder label={(ALL_NAV.find(n => n.id === view) || ALL_NAV[0]).label} />

  const ModuleView = moduleView(view)
  if (ModuleView) return <ModuleView adapters={adapters} host={host} tweaks={tweaks} setTweak={setTweak} />

  if (view === 'settings') {
    return <DesktopSettings tweaks={tweaks} setTweak={setTweak} nav={INSTALLED_NAV} defaultNavOrder={DEFAULT_TWEAKS.navOrder} />
  }
  return <Placeholder label={(ALL_NAV.find(n => n.id === view) || ALL_NAV[0]).label} />
}

const FIRST_VIEW = INSTALLED_NAV[0]?.id || 'dashboard'

// An install of one app with one screen has nothing to switch between, so it has no sidebar: Settings is
// a gear in the title bar instead.
const BARE = isBareStandalone(registry.mode, INSTALLED_NAV.length)

const FULL_BLEED = new Set(['markdown', 'devenv', 'git', 'db-manager', 'editor'])
// Views that hide the nav sidebar to give their own layout the width; the top bar's
// nav button (or Ctrl+B) brings it back while on them. None at the moment.
const NAV_HIDDEN = new Set([])

function WindowControls() {
  if (windowControlsAdapter.platform() === 'darwin') return null;
  return (
    <div style={{ display: 'flex', alignSelf: 'stretch', marginLeft: BARE ? 0 : 'auto', marginTop: -10, marginBottom: -10 }}>
      <button className="wc-btn" onClick={() => windowControlsAdapter.minimize()} title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1" aria-hidden="true">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button className="wc-btn" onClick={() => windowControlsAdapter.maximize()} title="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0h10v10H0V0zm1 1v8h8V1H1z" fill="currentColor" />
        </svg>
      </button>
      <button className="wc-btn wc-close" onClick={() => windowControlsAdapter.close()} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

function App() {
  // Start on the first installed app's first view (Dashboard in a full install).
  const [view, setView]         = React.useState(() => resolveView(takeWaitingNavigation()) || FIRST_VIEW)
  // Every view visited this session, in order; mountedViews keeps the kept-alive ones mounted.
  const [visited, setVisited]   = React.useState(() => [view])
  React.useEffect(() => { setVisited(v => (v.includes(view) ? v : [...v, view])) }, [view])
  const [sidebarWidth, setSidebarWidth] = usePersistedState('nexusmd.sidebar.width', 220)
  const [tweaks, setTweaksState] = React.useState(loadTweaks)

  // Fall back to clientWidth when innerWidth is 0 (e.g. jsdom in tests) so the
  // sidebar doesn't spuriously start collapsed.
  const [winWidth, setWinWidth] = React.useState(() => window.innerWidth || document.documentElement.clientWidth || 1280)
  React.useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const effSidebar = effectiveSidebar(winWidth, tweaks.sidebar)
  const iconsOnly  = effSidebar === 'icons'
  // Below the breakpoint the rail is icons whatever the preference, so the toggle can't expand it.
  const sidebarForced = winWidth < SIDEBAR_BREAKPOINT
  // Shown by hand on a NAV_HIDDEN view; resets whenever the view changes.
  const [navShown, setNavShown] = React.useState(false)
  React.useEffect(() => { setNavShown(false) }, [view])
  const navHidden = BARE || (NAV_HIDDEN.has(view) && !navShown)

  // The window, and so the taskbar, is named for what is installed.
  React.useEffect(() => { document.title = registry.identity.productName }, [])

  const setTweak = React.useCallback((key, value) => {
    setTweaksState(prev => {
      const next = { ...prev, [key]: value }
      try { localStorage.setItem('nexusmd.tweaks', JSON.stringify(next)) } catch (_) {}
      return next
    })
  }, [])

  React.useEffect(() => {
    document.body.dataset.theme = paletteFor(tweaks)
    // The stylesheet has taken over from the background index.html's preload script set (build/theme-preload.mjs).
    document.documentElement.style.backgroundColor = ''
  }, [tweaks.theme, tweaks.darkTheme, tweaks.dimTheme, tweaks.lightTheme])

  React.useEffect(() => {
    window.nexusMDTypeLabels = tweaks.typeLabels || false
  }, [tweaks.typeLabels])

  // Counts of new items the installed apps show on their sidebar entries.
  const changeBadges = useModuleBadges()
  // Screens an app has switched off (Settings > Desktop): off the sidebar, and links to them do nothing.
  const offViews = useModuleOffViews()
  const offViewsRef = React.useRef(offViews)
  offViewsRef.current = offViews

  const active = ALL_NAV.find(n => n.id === view) || ALL_NAV[0]
  React.useEffect(() => {
    const handler = e => {
      takeWaitingNavigation()   // heard live, so nothing is left waiting
      const detail = e.detail
      // Accept both the string payload (desktop-internal dispatches) and the
      // { view, filter } object payload used by shared @nexusmd/ui components.
      const next = resolveView(typeof detail === 'string' ? detail : detail?.view)
      const filter = (detail && typeof detail === 'object') ? (detail.filter || null) : null
      if (next && !isUninstalledView(next) && !offViewsRef.current.includes(next)) {
        // Stash the filter so views (e.g. PRView's focused work item) can consume it,
        // mirroring the web host's window.NexusMDNav mechanism.
        window.NexusMDNav = { pendingFilter: filter, view: next }
        setView(next)
      }
    }
    window.addEventListener('nexusmd:navigate', handler)
    return () => window.removeEventListener('nexusmd:navigate', handler)
  }, [])

  // What the sidebar shows, in its order; the number keys jump to the entry with that number.
  const shownNav = visibleNav(tweaks.navOrder, tweaks.navHidden, INSTALLED_NAV).filter(item => !offViews.includes(item.id))
  const shownNavRef = React.useRef(shownNav)
  shownNavRef.current = shownNav
  // On a screen that is switched off (it was the start screen, or a saved or linked one): move to the
  // first one still on, or Settings if the sidebar is empty.
  const fallbackView = shownNav[0]?.id || SETTINGS_NAV.id
  React.useEffect(() => {
    if (offViews.includes(view)) setView(fallbackView)
  }, [offViews, view, fallbackView])
  React.useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const idx = parseInt(e.key, 10)
      if (idx >= 1 && idx <= 9) {
        const target = shownNavRef.current[idx - 1]
        if (target) setView(target.id)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Ctrl+B collapses the sidebar to icons, or expands it back to labels.
  React.useEffect(() => {
    const handler = e => {
      if (BARE || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b' || e.defaultPrevented) return
      e.preventDefault()
      if (NAV_HIDDEN.has(view)) setNavShown(v => !v)
      else setTweak('sidebar', toggledSidebar(tweaks.sidebar))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [tweaks.sidebar, setTweak, view])

  return (
    <NexusDataProvider value={BASE_DATA}>
    {/* Above ViewBody so what an app owns (e.g. a devenv run and its prompts) outlives leaving its screen. */}
    <ModuleProviders adapters={adapters} view={view} notify={(title, body, opts) => notificationAdapter.send(title, body, opts)}>
      <div data-density={tweaks.density} data-sidebar={effSidebar}
        style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {!navHidden && <aside style={{
          width: iconsOnly ? ICON_RAIL_WIDTH : sidebarWidth,
          minWidth: iconsOnly ? ICON_RAIL_WIDTH : sidebarWidth,
          flexShrink: 0, borderRight: '1px solid var(--border)',
          padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 2,
          background: 'var(--surface, transparent)', position: 'relative',
        }}>
          <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 14px' }}>
            <Icon name="dashboard" size={18} />
            {!iconsOnly && <strong style={{ fontSize: 14 }}>NexusMD</strong>}
          </div>
          {shownNav.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              title={iconsOnly ? item.label : undefined}
              style={{
                display: 'flex', alignItems: 'center',
                justifyContent: iconsOnly ? 'center' : 'flex-start',
                gap: 10, padding: iconsOnly ? '8px' : '8px 10px',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: view === item.id ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
                color: view === item.id ? 'var(--accent)' : 'var(--text-muted)',
                font: 'inherit', fontSize: 13, position: 'relative',
              }}
            >
              <Icon name={item.icon} size={16} />
              {!iconsOnly && item.label}
              {changeBadges[item.id] > 0 && (
                iconsOnly ? (
                  <span style={{
                    position: 'absolute', top: 4, right: 4, width: 8, height: 8,
                    background: 'var(--accent)', borderRadius: '50%',
                  }} />
                ) : (
                  <span style={{
                    marginLeft: 'auto', minWidth: 18, height: 18,
                    background: 'var(--accent)', color: 'var(--on-accent)',
                    borderRadius: 9, fontSize: 11, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 5px',
                  }}>
                    {changeBadges[item.id] > 99 ? '99+' : changeBadges[item.id]}
                  </span>
                )
              )}
              {!iconsOnly && tweaks.sidebar === 'labels' && idx < 9 && !changeBadges[item.id] && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-subtle)', opacity: 0.5 }}>
                  {idx + 1}
                </span>
              )}
            </button>
          ))}
          <div style={{ marginTop: 'auto' }} />
          <button
            key={SETTINGS_NAV.id}
            onClick={() => setView(SETTINGS_NAV.id)}
            className={`nav-item ${view === SETTINGS_NAV.id ? 'active' : ''}`}
            title={iconsOnly ? SETTINGS_NAV.label : undefined}
            style={{
              display: 'flex', alignItems: 'center',
              justifyContent: iconsOnly ? 'center' : 'flex-start',
              gap: 10, padding: iconsOnly ? '8px' : '8px 10px',
              border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
              background: view === SETTINGS_NAV.id ? 'var(--accent-soft, rgba(127,127,127,0.12))' : 'transparent',
              color: view === SETTINGS_NAV.id ? 'var(--accent)' : 'var(--text-muted)',
              font: 'inherit', fontSize: 13, position: 'relative',
            }}
          >
            <Icon name={SETTINGS_NAV.icon} size={16} />
            {!iconsOnly && SETTINGS_NAV.label}
          </button>
          <button
            className="nav-item"
            onClick={() => setTweak('sidebar', toggledSidebar(tweaks.sidebar))}
            disabled={sidebarForced}
            aria-label={iconsOnly ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!iconsOnly}
            title={sidebarForced ? 'Widen the window to show labels' : `${iconsOnly ? 'Expand sidebar' : 'Collapse sidebar to icons'} (Ctrl+B)`}
            style={{
              display: 'flex', alignItems: 'center',
              justifyContent: iconsOnly ? 'center' : 'flex-start',
              gap: 10, padding: iconsOnly ? '8px' : '8px 10px',
              border: 'none', borderRadius: 8, cursor: sidebarForced ? 'default' : 'pointer', textAlign: 'left',
              background: 'transparent', color: 'var(--text-subtle)', opacity: sidebarForced ? 0.4 : 1,
              font: 'inherit', fontSize: 12,
            }}
          >
            <Icon name={iconsOnly ? 'chevron-right' : 'chevron-left'} size={16} />
            {!iconsOnly && 'Collapse'}
          </button>
          {!iconsOnly && (
            <div
              style={{ position: 'absolute', top: 0, right: -3, width: 6, height: '100%', cursor: 'col-resize', zIndex: 10 }}
              onMouseDown={e => {
                e.preventDefault()
                const startX = e.clientX
                const startW = sidebarWidth
                const onMove = (me) => {
                  const next = Math.max(160, Math.min(320, startW + me.clientX - startX))
                  setSidebarWidth(next)
                }
                const onUp = () => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
          )}
        </aside>}

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <header className="topbar" style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 10px 18px',
            borderBottom: '1px solid var(--border)',
          }}>
            {navHidden && !BARE && (
              <button className="btn sm ghost" aria-label="Show navigation" title="Show navigation (Ctrl+B)"
                onClick={() => setNavShown(true)}>
                <Icon name="list" size={14}/>
              </button>
            )}
            <Icon name={active.icon} size={16} />
            <h1 style={{ fontSize: 15, margin: 0 }}>{active.label}</h1>
            <ModuleTopbar view={view} />
            {BARE && (
              <button className="btn sm ghost" style={{ marginLeft: 'auto' }}
                aria-label={view === SETTINGS_NAV.id ? `Back to ${INSTALLED_NAV[0].label}` : 'Settings'}
                title={view === SETTINGS_NAV.id ? `Back to ${INSTALLED_NAV[0].label}` : 'Settings'}
                onClick={() => setView(view === SETTINGS_NAV.id ? FIRST_VIEW : SETTINGS_NAV.id)}>
                <Icon name={view === SETTINGS_NAV.id ? INSTALLED_NAV[0].icon : SETTINGS_NAV.icon} size={14} />
              </button>
            )}
            <WindowControls />
          </header>
          <AppUpdatesBanner />
          <ModuleBanners />
          <section style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            // These views lay out their own padding and scrolling (a scrolling page beside a fixed drawer).
            overflow: FULL_BLEED.has(view) ? 'hidden' : 'auto',
            padding: FULL_BLEED.has(view) ? 0 : 18,
          }}>
            {mountedViews(visited.filter(id => !offViews.includes(id)), view).map(id => (
            <div key={id} style={{ display: id === view ? 'contents' : 'none' }}>
            <ViewBody view={id} tweaks={tweaks} setTweak={setTweak} />
            </div>
            ))}
          </section>
        </main>
      </div>
      <ToastHost />
      <TweaksPanel title="Display">
        <TweakSection title="Appearance">
          <TweakRadio label="Theme" value={tweaks.theme}
            onChange={v => setTweak('theme', v)}
            options={THEME_MODES.map(m => ({ label: m.label, value: m.id }))}/>
          <TweakRadio label="Density" value={tweaks.density}
            onChange={v => setTweak('density', v)}
            options={[{label:'Compact',value:'compact'},{label:'Balanced',value:'balanced'},{label:'Cozy',value:'cozy'}]}/>
          <TweakRadio label="Sidebar" value={tweaks.sidebar}
            onChange={v => setTweak('sidebar', v)}
            options={[{label:'Labels',value:'labels'},{label:'Icons',value:'icons'}]}/>
          <TweakToggle label="Show type labels" value={tweaks.typeLabels || false}
            onChange={v => setTweak('typeLabels', v)}/>
        </TweakSection>
        {registry.isInstalled('work') && (
          <TweakSection title="Dashboard">
            <TweakButton label="Reset widget order"
              onClick={() => setTweak('widgetOrder', DASH_WIDGET_ORDER)}/>
          </TweakSection>
        )}
      </TweaksPanel>
    </ModuleProviders>
    </NexusDataProvider>
  )
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('Uncaught render error:', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14,
        background: 'var(--surface, #1e1e1e)', color: 'var(--text, #eee)',
        fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 24,
      }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Something went wrong</h2>
        <p style={{ margin: 0, maxWidth: 480, fontSize: 13, opacity: 0.8 }}>
          {this.state.error?.message || 'The app hit an unexpected error and could not continue rendering.'}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload app</button>
        </div>
      </div>
    )
  }
}

// An app's pop-out window (e.g. a Git editor, diff or conflict screen) shows one screen; it isn't the app.
const popout = findPopout(window.location.hash)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ProfileProvider>
        {popout ? <popout.Component spec={popout.spec} adapter={popout.adapter} /> : <App />}
      </ProfileProvider>
    </AppErrorBoundary>
  </React.StrictMode>
)

if (!popout) startDesktopAutoSync()
