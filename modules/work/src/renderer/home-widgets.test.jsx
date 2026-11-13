import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'

let profile = { activeProfile: { type: 'manual' } }
const hostCtx = []
const toasts = []
vi.mock('@nexusmd/ui', async importOriginal => {
  const ui = await importOriginal()
  return {
    ...ui,
    useProfile: () => profile,
    toast: (...args) => { toasts.push(args) },
    // The real widget, recording the ctx it was given.
    WidgetBody: props => { hostCtx.push(props.ctx); return ui.WidgetBody(props) },
  }
})
vi.mock('@nexusmd/shell-sdk', async importOriginal => ({
  ...(await importOriginal()),
  getProfileKey: k => `nexusmd.p.p1.${k}`,
}))

import { NexusDataProvider } from '@nexusmd/ui'
import { WorkContext } from './work-context.js'
import { HomeWidgets, desktopOffPages } from './home-widgets.jsx'
import { setOffScreens, resetOffScreensCache } from './work-screens.js'

const DATA = {
  WORK_ITEMS: [{ id: 1, title: 'Fix login', assignee: 'me', state: 'Active' }],
  PRS: [], BUILDS: [{ id: 'b1', pipeline: 'CI', status: 'succeeded' }], TESTS: [],
  ME: { id: 'me' },
}
const allInstalled = { isInstalled: () => true, capabilities: { has: () => false } }

// Holds the tweaks like the shell does, so a save shows up on the next render.
function Harness({ host = allInstalled, initial = [], onSet = () => {} }) {
  const [tweaks, setTweaks] = React.useState({ homeWidgets: initial })
  const setTweak = (k, v) => { onSet(k, v); setTweaks(t => ({ ...t, [k]: v })) }
  return <HomeWidgets host={host} tweaks={tweaks} setTweak={setTweak} team={[{ id: 'p1', name: 'Pat' }]} />
}
function mount(ui, data = DATA) {
  const work = { openItem: vi.fn(), openPR: vi.fn() }
  return render(
    <NexusDataProvider value={{ data }}>
      <WorkContext.Provider value={work}>{ui}</WorkContext.Provider>
    </NexusDataProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetOffScreensCache()
  profile = { activeProfile: { type: 'manual' } }
  hostCtx.length = 0
  toasts.length = 0
})
afterEach(cleanup)

describe('Home widgets on the desktop Dashboard', () => {
  it('Add widget opens the sheet, saving adds a widget, removing deletes it', () => {
    const onSet = vi.fn()
    mount(<Harness onSet={onSet} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('Add a widget')).toBeTruthy()
    fireEvent.click(within(sheet).getByText('Assigned to me'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add widget' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    const saved = onSet.mock.calls.at(-1)
    expect(saved[0]).toBe('homeWidgets')
    expect(saved[1]).toHaveLength(1)
    expect(saved[1][0]).toMatchObject({ type: 'mywork', config: { count: 5 } })
    // The widget shows, with the profile's own work in it.
    expect(screen.getByText('Fix login')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Assigned to me widget' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    expect(onSet).toHaveBeenLastCalledWith('homeWidgets', [])
    expect(screen.queryByText('Fix login')).toBeNull()
  })

  it('renders the sheet in a full-window overlay', () => {
    mount(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    const veil = screen.getByRole('dialog').closest('.m-sheet-veil')
    expect(veil.parentElement.classList.contains('m-sheet-overlay')).toBe(true)
    expect(veil.parentElement.parentElement).toBe(document.body)
  })

  it('a widget for a switched-off app is hidden', () => {
    setOffScreens(['builds'])
    const host = { isInstalled: id => id !== 'time', capabilities: { has: () => false } }
    mount(<Harness host={host} initial={[
      { id: 'w1', type: 'builds', config: { count: 3 } },
      { id: 'w2', type: 'time', config: {} },
      { id: 'w3', type: 'mywork', config: { count: 5 } },
    ]} />)
    expect(screen.queryByText('Builds')).toBeNull()
    expect(screen.queryByText('CI')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit Time widget' })).toBeNull()
    expect(screen.getByText('Fix login')).toBeTruthy()

    // Nor are they offered.
    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.queryByText('Builds')).toBeNull()
    expect(sheet.queryByText('Time')).toBeNull()
    expect(sheet.getByText('Assigned to me')).toBeTruthy()
  })

  it('offers no widget it has no desktop data for, and maps the screen names', () => {
    expect(desktopOffPages({ workOff: ['prs'], listsHidden: true, isInstalled: () => true }))
      .toEqual(expect.arrayContaining(['pr', 'lists', 'calendar', 'git']))
    expect(desktopOffPages({ workOff: [], listsHidden: false, isInstalled: () => true })).not.toContain('lists')
    expect(desktopOffPages({ workOff: [], listsHidden: false, isInstalled: id => id !== 'planner' })).toContain('planner')
  })

  it('passes the same timer store across re-renders', () => {
    const { rerender } = mount(<Harness initial={[{ id: 'w1', type: 'time', config: {} }]} />)
    rerender(
      <NexusDataProvider value={{ data: { ...DATA, PRS: [{ id: 9 }] } }}>
        <WorkContext.Provider value={{ openItem: vi.fn(), openPR: vi.fn() }}>
          <Harness initial={[{ id: 'w1', type: 'time', config: {} }]} />
        </WorkContext.Provider>
      </NexusDataProvider>,
    )
    expect(hostCtx.length).toBeGreaterThan(1)
    expect(hostCtx[0].timer).toBeTruthy()
    for (const c of hostCtx) expect(c.timer).toBe(hostCtx[0].timer)
  })

  it('keeps the timer log where the Time screen keeps it, and reads the profile\'s lists', () => {
    localStorage.setItem('nexusmd.p.p1.nexusmd.lists', JSON.stringify({ lists: [{ id: 'l1', name: 'Groceries', items: [{ id: 'i1' }] }] }))
    mount(<Harness initial={[{ id: 'w1', type: 'lists', config: { count: 5 } }]} />)
    expect(screen.getByText('Groceries')).toBeTruthy()
    const { timer } = hostCtx.at(-1)
    timer.save({ entries: [] })
    expect(localStorage.getItem('nexusmd.p.p1.nexusmd.timelog.v1')).toBe('{"entries":[]}')
  })
})

describe('File or folder shortcuts on the desktop Dashboard', () => {
  const REPOS = [
    { name: 'nexus', path: 'C:/repos/nexus', provider: 'local', remote: 'github.com/knownexus/nexus' },
    { name: 'scratch', path: 'C:/repos/scratch', provider: 'local', remote: '' },
  ]
  const gitLink = (over = {}) => ({
    id: 'k1', type: 'link',
    config: { target: 'git', kind: 'file', path: '/src/app.js', repo: { provider: 'github', name: 'nexus', fullName: 'knownexus/nexus' }, ...over },
  })
  const editorLink = (over = {}) => ({
    id: 'k2', type: 'link', config: { target: 'editor', kind: 'file', path: 'C:\notes\todo.md', name: 'todo.md', platform: 'desktop', ...over },
  })
  // A host whose apps offer these capabilities; `call` records and answers them.
  function hostWith({ provides = ['git.listRepos', 'git.openPath', 'editor.openPath'], repos = REPOS, editorOpens = true, installed = () => true } = {}) {
    const calls = []
    const call = vi.fn(async (name, ...args) => {
      calls.push([name, ...args])
      if (name === 'git.listRepos') return repos
      if (name === 'editor.openPath') return editorOpens
      return true
    })
    return { host: { isInstalled: installed, capabilities: { has: n => provides.includes(n), call } }, call, calls }
  }
  const tile = name => screen.getByRole('button', { name: new RegExp(`^${name}`) })

  it('shows a repository shortcut although the Repo widget is not offered, and opens it in the local clone found by remote', async () => {
    const { host, calls } = hostWith()
    mount(<Harness host={host} initial={[gitLink()]} />)
    await screen.findByText('app.js')
    fireEvent.click(tile('app.js'))
    await vi.waitFor(() => expect(calls.some(c => c[0] === 'git.openPath')).toBe(true))
    expect(calls.find(c => c[0] === 'git.openPath')[1]).toEqual({
      path: '/src/app.js', kind: 'file', repoPath: 'C:/repos/nexus', githubRepo: 'knownexus/nexus',
    })
  })

  it('carries the shortcut’s branch', async () => {
    const { host, calls } = hostWith()
    mount(<Harness host={host} initial={[gitLink({ branch: 'dev' })]} />)
    fireEvent.click(await screen.findByText('app.js'))
    await vi.waitFor(() => expect(calls.some(c => c[0] === 'git.openPath')).toBe(true))
    expect(calls.find(c => c[0] === 'git.openPath')[1].branch).toBe('dev')
  })

  it('falls back to GitHub for a GitHub repository with no local clone, and is not greyed', async () => {
    const { host, calls } = hostWith({ repos: [REPOS[1]] })
    mount(<Harness host={host} initial={[gitLink()]} />)
    const t = await screen.findByText('app.js')
    await vi.waitFor(() => expect(calls.some(c => c[0] === 'git.listRepos')).toBe(true))
    expect(tile('app.js').getAttribute('aria-disabled')).toBe('false')
    fireEvent.click(t)
    await vi.waitFor(() => expect(calls.some(c => c[0] === 'git.openPath')).toBe(true))
    const spec = calls.find(c => c[0] === 'git.openPath')[1]
    expect(spec.githubRepo).toBe('knownexus/nexus')
    expect(spec).not.toHaveProperty('repoPath')
  })

  it('greys out an Azure DevOps repository that is not cloned here, and says why instead of opening it', async () => {
    const { host, calls } = hostWith({ repos: [REPOS[1]] })
    mount(<Harness host={host} initial={[gitLink({ repo: { provider: 'ado', name: 'api', project: 'Core' } })]} />)
    await vi.waitFor(() => expect(tile('app.js').getAttribute('aria-disabled')).toBe('true'))
    fireEvent.click(tile('app.js'))
    expect(await screen.findByText('This repository is not available on this device.')).toBeTruthy()
    expect(calls.some(c => c[0] === 'git.openPath')).toBe(false)
  })

  it('asks Git Workspace for its repositories only when a shortcut needs them', async () => {
    const { host, call } = hostWith()
    mount(<Harness host={host} initial={[editorLink()]} />)
    await screen.findByText('todo.md')
    expect(call).not.toHaveBeenCalledWith('git.listRepos')
  })

  it('hides a repository shortcut when Git Workspace is not installed', () => {
    const { host } = hostWith({ provides: [], installed: id => id !== 'git' })
    mount(<Harness host={host} initial={[gitLink()]} />)
    expect(screen.queryByText('app.js')).toBeNull()
  })

  it('opens an Editor shortcut through the Editor', async () => {
    const { host, calls } = hostWith()
    mount(<Harness host={host} initial={[editorLink()]} />)
    fireEvent.click(await screen.findByText('todo.md'))
    await vi.waitFor(() => expect(calls).toContainEqual(['editor.openPath', 'C:\notes\todo.md']))
    expect(toasts).toEqual([])
  })

  it('says when the Editor’s file is gone, on the Dashboard', async () => {
    const { host } = hostWith({ editorOpens: false })
    mount(<Harness host={host} initial={[editorLink()]} />)
    fireEvent.click(await screen.findByText('todo.md'))
    await vi.waitFor(() => expect(toasts).toContainEqual(['todo.md no longer exists.', 'error']))
  })

  it('greys out an Editor shortcut made on the phone', async () => {
    const { host, calls } = hostWith()
    mount(<Harness host={host} initial={[editorLink({ path: '/editor/a.md', name: 'a.md', platform: 'mobile' })]} />)
    fireEvent.click(await screen.findByText('a.md'))
    expect(await screen.findByText('This was made on another kind of device and opens only there.')).toBeTruthy()
    expect(calls.some(c => c[0] === 'editor.openPath')).toBe(false)
  })

  it('hides an Editor shortcut when the Editor app is not installed', () => {
    const { host } = hostWith({ installed: id => id !== 'editor' })
    mount(<Harness host={host} initial={[editorLink()]} />)
    expect(screen.queryByText('todo.md')).toBeNull()
  })

})

describe('Document shortcuts on the desktop Dashboard', () => {
  const docLink = (over = {}) => ({ id: 'k3', type: 'link', config: { target: 'doc', tool: 'json', docId: 'j1', name: 'Settings', ...over } })
  const seedDocs = () => {
    localStorage.setItem('nexusmd.p.p1.md_documents', JSON.stringify({ docs: [{ id: 'm1', autoName: 'Plan' }] }))
    localStorage.setItem('nexusmd.p.p1.json_editor_documents', JSON.stringify([{ id: 'j1', autoName: 'Settings' }]))
  }
  function hostWith({ opens = true, provides = ['documents.openDoc'], installed = () => true } = {}) {
    const calls = []
    const call = vi.fn(async (name, ...args) => { calls.push([name, ...args]); return name === 'documents.openDoc' ? opens : true })
    return { host: { isInstalled: installed, capabilities: { has: n => provides.includes(n), call } }, calls }
  }

  it('opens a saved document through Documents, in its own tool', async () => {
    seedDocs()
    const { host, calls } = hostWith()
    mount(<Harness host={host} initial={[docLink()]} />)
    fireEvent.click(await screen.findByText('Settings'))
    await vi.waitFor(() => expect(calls).toContainEqual(['documents.openDoc', { tool: 'json', docId: 'j1' }]))
    expect(toasts).toEqual([])
  })

  it('says so on the Dashboard when the document went between showing it and the click', async () => {
    seedDocs()
    const { host } = hostWith({ opens: false })
    mount(<Harness host={host} initial={[docLink()]} />)
    fireEvent.click(await screen.findByText('Settings'))
    await vi.waitFor(() => expect(toasts).toContainEqual(['Settings no longer exists.', 'error']))
  })

  it('greys out a shortcut to a document that is no longer saved, and explains on tap', async () => {
    seedDocs()
    const { host, calls } = hostWith()
    mount(<Harness host={host} initial={[docLink({ docId: 'deleted' })]} />)
    fireEvent.click(await screen.findByText('Settings'))
    expect(await screen.findByText('This document no longer exists.')).toBeTruthy()
    expect(calls).toEqual([])
  })

  it('finds a Markdown document in the Markdown store, not the JSON one', async () => {
    seedDocs()
    const { host } = hostWith()
    mount(<Harness host={host} initial={[docLink({ tool: 'markdown', docId: 'j1', name: 'Wrong tool' })]} />)
    fireEvent.click(await screen.findByText('Wrong tool'))
    expect(await screen.findByText('This document no longer exists.')).toBeTruthy()
  })

  it('hides a document shortcut when the Documents app is not installed', () => {
    seedDocs()
    const { host } = hostWith({ installed: id => id !== 'documents' })
    mount(<Harness host={host} initial={[docLink()]} />)
    expect(screen.queryByText('Settings')).toBeNull()
  })
})

describe('Making a File or folder shortcut on the desktop Dashboard', () => {
  const REPO = { name: 'nexus', path: 'C:/repos/nexus', provider: 'local', remote: 'github.com/knownexus/nexus' }
  function hostWith(provides) {
    const call = vi.fn(async name => (name === 'git.listRepos' ? [REPO] : name === 'git.listFiles' ? { files: ['src/app.js'], truncated: false } : true))
    return { host: { isInstalled: () => true, adapters: { picker: { pickFile: vi.fn(), pickDirectory: vi.fn() } }, capabilities: { has: n => provides.includes(n), call } }, call }
  }
  const dialog = () => within(screen.getByRole('dialog'))

  it('picks a repository file, names the clone by its GitHub owner and name, and adds it to the Dashboard', async () => {
    const onSet = vi.fn()
    const { host } = hostWith(['git.listRepos', 'git.listFiles', 'git.openPath'])
    mount(<Harness host={host} onSet={onSet} />)
    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    fireEvent.click(dialog().getByText('File or folder'))
    fireEvent.click(await dialog().findByText('nexus'))
    fireEvent.click(await dialog().findByText('src'))
    fireEvent.click(await dialog().findByText('app.js'))
    expect(await dialog().findByText('Opens')).toBeTruthy()
    fireEvent.click(dialog().getByRole('button', { name: 'Add widget' }))
    const saved = onSet.mock.calls.at(-1)
    expect(saved[0]).toBe('homeWidgets')
    expect(saved[1]).toEqual([{
      id: expect.any(String), type: 'link',
      config: {
        target: 'git', kind: 'file', path: '/src/app.js',
        repo: { provider: 'github', name: 'nexus', fullName: 'knownexus/nexus', remote: 'github.com/knownexus/nexus' },
      },
    }])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('app.js')).toBeTruthy()
  })

  it('picks a whole repository as its top folder', async () => {
    const onSet = vi.fn()
    const { host } = hostWith(['git.listRepos', 'git.listFiles', 'git.openPath'])
    mount(<Harness host={host} onSet={onSet} />)
    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    fireEvent.click(dialog().getByText('File or folder'))
    fireEvent.click(await dialog().findByText('nexus'))
    fireEvent.click(await dialog().findByRole('button', { name: 'Choose this folder' }))
    fireEvent.click(await dialog().findByRole('button', { name: 'Add widget' }))
    expect(onSet.mock.calls.at(-1)[1][0].config).toMatchObject({ kind: 'folder', path: '/' })
  })

  it('does not offer the type when no app can supply anything to choose', () => {
    mount(<Harness host={hostWith([]).host} />)
    fireEvent.click(screen.getByRole('button', { name: /Add widget/ }))
    expect(dialog().queryByText('File or folder')).toBeNull()
  })
})
