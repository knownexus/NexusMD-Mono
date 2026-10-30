// Ways the app could fail to run on a real phone that a clean first launch does not show: a screen
// that throws when opened, a tablet-sized window, data saved by an older version that no longer
// parses, and providers that are connected but unreachable (airplane mode, an expired token).
// Every one of them has to leave the app on screen, not a white page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const SCREENS = {
  primary: ['Home', 'Work', 'Planner', 'PRs'],
  more: ['Builds', 'Tests', 'Calendar', 'Triage', 'Team', 'Documents', 'API Client', 'Editor', 'Repos', 'Settings'],
}

let errors
const onError = e => { errors.push(e.error?.message || e.message || String(e)); e.preventDefault?.() }
const root = () => document.getElementById('root')
const tick = (ms = 150) => new Promise(r => setTimeout(r, ms))
const buttonByText = (scope, text) => [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === text)

// jsdom has no layout, so answer the width queries the app uses from window.innerWidth.
function mediaFor(width) {
  return query => {
    const max = query.match(/max-width:\s*(\d+)px/)
    const min = query.match(/min-width:\s*(\d+)px/)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
  }
}

async function boot({ width = 412 } = {}) {
  vi.resetModules()
  window.matchMedia = mediaFor(width)
  document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'root' }))
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  await import('./main.jsx')
  await vi.waitFor(() => expect(root().children.length).toBeGreaterThan(0), { timeout: 15000 })
}

describe('the app stays up', () => {
  beforeEach(() => {
    errors = []
    localStorage.clear()
    window.addEventListener('error', onError)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    // React reports a render error on the console as well; keep this run's output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { window.removeEventListener('error', onError); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('opens every screen without throwing', async () => {
    await boot()
    const nav = () => root().querySelector('.m-bottomnav')
    await vi.waitFor(() => expect(nav()).not.toBeNull(), { timeout: 15000 })
    const failures = []
    const visit = async (label, open) => {
      const before = errors.length
      open()
      await tick()
      if (!root().children.length) failures.push(`${label}: the app went blank`)
      if (errors.length > before) failures.push(`${label}: ${errors.slice(before).join(' | ')}`)
    }
    for (const label of SCREENS.primary) {
      await visit(label, () => buttonByText(nav(), label)?.click())
    }
    for (const label of SCREENS.more) {
      await visit(label, () => {
        buttonByText(nav(), 'More')?.click()
      })
      const item = [...document.body.querySelectorAll('button')].filter(b => b.textContent.trim() === label).pop()
      if (!item) { failures.push(`${label}: not in the More menu`); continue }
      await visit(label, () => item.click())
    }
    expect(failures).toEqual([])
  }, 60000)

  it('renders the tablet layout on a wide window', async () => {
    await boot({ width: 1100 })
    try {
      await vi.waitFor(() => expect(root().querySelector('.m-rail')).not.toBeNull(), { timeout: 10000 })
    } catch (e) {
      throw new Error(`no .m-rail; errors=${errors.join('|')}; root=${root().innerHTML.slice(0, 400)}`)
    }
    expect(errors).toEqual([])
  }, 30000)

  it('starts from saved data an older version left unreadable', async () => {
    await boot()
    // Whatever keys a first launch wrote, an older release could have left them as anything.
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    expect(keys.length).toBeGreaterThan(0)
    for (const k of keys) localStorage.setItem(k, '{not json')
    await boot()
    await vi.waitFor(() => expect(root().textContent.length).toBeGreaterThan(0), { timeout: 10000 })
    expect(errors.filter(m => /is not defined/.test(m))).toEqual([])
  }, 60000)

  it('starts with Azure DevOps and Jira connected but the network down', async () => {
    await boot()
    const { saveAdoConfig } = await import('./ado-client.js')
    const { saveJiraConfig } = await import('./jira-client.js')
    saveAdoConfig({ org: 'acme', pat: 'p', projects: ['P'] })
    saveJiraConfig({ site: 'acme', email: 'a@b.c', apiToken: 't', projectKeys: ['ABC'] })
    await boot()
    await tick(500)
    expect(root().children.length).toBeGreaterThan(0)
    expect(errors.filter(m => /is not defined/.test(m))).toEqual([])
  }, 60000)
})
