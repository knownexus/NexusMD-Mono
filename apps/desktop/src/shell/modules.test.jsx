import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// modules.js activates the installed apps at load; only its pure logic is under test here.
vi.mock('./host.js', async () => {
  const { createCapabilities } = await import('@nexusmd/shell-sdk')
  return { host: { name: 'the host', capabilities: createCapabilities(), navigate: () => {}, isInstalled: () => true, cloud: {} }, takeWaitingNavigation: () => null }
})

import {
  loadModules, modulePanels, useModuleBadges, useModuleOffViews, ModuleTopbar, ModuleBanners, ModuleProviders, moduleView, moduleAdapters,
} from './modules.js'
import { buildRegistry } from './registry.js'

afterEach(cleanup)

const mod = (id, extra = {}) => ({ id, ...extra })

describe('loadModules', () => {
  const all = [mod('git'), mod('work'), mod('planner'), mod('notes')]

  it('keeps only installed apps, in the apps\' own order', () => {
    const reg = buildRegistry(['git', 'planner', 'work'])
    expect(loadModules(reg, all).map(m => m.id)).toEqual(['work', 'planner', 'git'])
  })
  it('is everything, in order, when nothing narrows the set', () => {
    expect(loadModules(buildRegistry(), all).map(m => m.id)).toEqual(['work', 'planner', 'notes', 'git'])
  })
})

describe('modulePanels', () => {
  const Plain = () => null
  const Late = () => null
  const Early = () => null
  const mods = [
    mod('a', { settingsPanels: { planner: Plain, other: Plain } }),
    mod('b', { settingsPanels: { planner: { Panel: Late, order: 100 } } }),
    mod('c', { settingsPanels: { planner: { Panel: Early, order: -1 } } }),
    mod('d'),
  ]
  it('lists only the apps that have a panel for the tab', () => {
    expect(modulePanels('other', mods).map(p => p.id)).toEqual(['a'])
    expect(modulePanels('nothing', mods)).toEqual([])
  })
  it('takes a component or { Panel, order }, lowest order first, apps in order otherwise', () => {
    const panels = modulePanels('planner', mods)
    expect(panels.map(p => p.id)).toEqual(['c', 'a', 'b'])
    expect(panels.map(p => p.Panel)).toEqual([Early, Plain, Late])
  })
})

describe('useModuleBadges', () => {
  function Probe({ mods }) { return <div>{JSON.stringify(useModuleBadges(mods))}</div> }
  it('merges the counts every app reports, and skips apps without any', () => {
    const mods = [mod('a', { useNavBadges: () => ({ work: 2 }) }), mod('b'), mod('c', { useNavBadges: () => ({ prs: 1, builds: 0 }) })]
    render(<Probe mods={mods} />)
    expect(screen.getByText('{"work":2,"prs":1,"builds":0}')).toBeTruthy()
  })
  it('is empty with no apps that report', () => {
    render(<Probe mods={[mod('a')]} />)
    expect(screen.getByText('{}')).toBeTruthy()
  })
})

describe('useModuleOffViews', () => {
  function Probe({ mods }) { return <div>{JSON.stringify(useModuleOffViews(mods))}</div> }
  it('collects the views every app has switched off', () => {
    const mods = [mod('a', { useOffViews: () => ['triage', 'team'] }), mod('b'), mod('c', { useOffViews: () => ['notes'] })]
    render(<Probe mods={mods} />)
    expect(screen.getByText('["triage","team","notes"]')).toBeTruthy()
  })
})

describe('top bar and banner slots', () => {
  const mods = [
    mod('a', { topbar: () => <span>a-top</span>, banner: () => <p>a-banner</p> }),
    mod('b'),
    mod('c', { topbar: () => <span>c-top</span> }),
  ]
  it('render what each app contributes, in order', () => {
    const { container } = render(<><ModuleTopbar mods={mods} /><ModuleBanners mods={mods} /></>)
    expect(container.textContent).toBe('a-topc-topa-banner')
  })
})

describe('ModuleProviders', () => {
  it('wraps the shell in each app\'s provider, first app outermost, passing the current view and host', () => {
    const seen = []
    const Provider = name => ({ children, view, host, adapters, notify }) => {
      seen.push({ name, view, host, adapters, notify })
      return <section data-name={name}>{children}</section>
    }
    const mods = [mod('a', { provider: Provider('a') }), mod('b'), mod('c', { provider: Provider('c') })]
    const adapters = { x: 1 }
    const notify = () => {}
    const { container } = render(<ModuleProviders mods={mods} adapters={adapters} notify={notify} view="git"><i>content</i></ModuleProviders>)
    expect(container.innerHTML).toBe('<section data-name="a"><section data-name="c"><i>content</i></section></section>')
    expect(seen.map(s => s.name)).toEqual(['a', 'c'])
    expect(seen[0]).toMatchObject({ view: 'git', host: { name: 'the host' }, adapters, notify })
  })
  it('is just the children when no app has a provider', () => {
    const { container } = render(<ModuleProviders mods={[mod('a')]}><i>content</i></ModuleProviders>)
    expect(container.innerHTML).toBe('<i>content</i>')
  })
})

describe('what the apps own', () => {
  it('moduleView finds the app that owns a view id', () => {
    const View = () => null
    expect(moduleView('git', [mod('x', { views: { git: View } })])).toBe(View)
    expect(moduleView('nope', [mod('x', { views: { git: View } })])).toBeUndefined()
  })
  it('moduleAdapters merges what the apps bring', () => {
    expect(moduleAdapters([mod('a', { adapters: { http: 1 } }), mod('b'), mod('c', { adapters: { git: 2 } })])).toEqual({ http: 1, git: 2 })
  })
})
