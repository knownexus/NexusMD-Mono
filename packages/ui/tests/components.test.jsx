import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Ring, SortHeader, StatusSelect, ProjectChip, Drawer, NexusDataProvider,
  useSeenTracking,
} from '../src/index.js'

afterEach(cleanup)

describe('pure presentational components', () => {
  it('StateDot colours by state category and shows the label when asked', () => {
    const { container } = render(<StateDot state="Done" withLabel />)
    // category-driven dot is the first inner span; label follows
    expect(container.textContent).toContain('Done')
    expect(container.querySelector('span > span')).toBeTruthy()
  })

  it('StateDot renders without a label by default', () => {
    const { container } = render(<StateDot state="Active" />)
    expect(container.textContent).toBe('')
  })

  it('Prio renders a P-pill for a set priority', () => {
    const { container } = render(<Prio p={2} />)
    expect(container.textContent).toContain('P2')
    expect(container.querySelector('.prio.p2')).toBeTruthy()
  })

  it('Prio renders an em-dash placeholder when empty', () => {
    const { container } = render(<Prio p={0} />)
    expect(container.textContent).toContain('—')
  })

  it('FilterChip reflects active state and count', () => {
    const { container } = render(<FilterChip active count={3}>Bugs</FilterChip>)
    expect(container.querySelector('.filter-chip.active')).toBeTruthy()
    expect(container.textContent).toContain('Bugs')
    expect(container.querySelector('.count')?.textContent).toBe('3')
  })

  it('FilterChip omits the count node when count is null', () => {
    const { container } = render(<FilterChip>All</FilterChip>)
    expect(container.querySelector('.count')).toBeNull()
  })

  it('CardFrame renders title, badge and body children', () => {
    const { container } = render(
      <CardFrame title="Builds" badge="3">
        <p>body</p>
      </CardFrame>,
    )
    expect(container.querySelector('.card-head h3')?.textContent).toBe('Builds')
    expect(container.querySelector('.pill')?.textContent).toBe('3')
    expect(container.querySelector('.card-body')?.textContent).toContain('body')
  })

  it('Sparkline renders a polyline for >=2 points and nothing for fewer', () => {
    const { container: ok } = render(<Sparkline data={[1, 4, 2, 8]} />)
    expect(ok.querySelector('polyline')?.getAttribute('points')).toBeTruthy()
    const { container: empty } = render(<Sparkline data={[5]} />)
    expect(empty.querySelector('svg')).toBeNull()
  })

  it('Stat shows label/value and embeds a sparkline when given data', () => {
    const { container } = render(<Stat label="Passing" value={42} spark={[1, 2, 3]} />)
    expect(container.querySelector('.stat-label')?.textContent).toContain('Passing')
    expect(container.querySelector('.stat-value')?.textContent).toBe('42')
    expect(container.querySelector('svg.spark')).toBeTruthy()
  })

  it('Stat renders a trend indicator inside meta', () => {
    const { container } = render(
      <Stat label="PRs" value={5} meta="this week" trend={{ dir: 'up', value: '+2' }} />,
    )
    expect(container.querySelector('.stat-trend.up')?.textContent).toContain('+2')
    expect(container.querySelector('.stat-meta')?.textContent).toContain('this week')
  })

  it('Ring shows a percentage label by default and a custom label when given', () => {
    const { container: pct } = render(<Ring value={3} max={4} />)
    expect(pct.textContent).toContain('75%')
    const { container: lbl } = render(<Ring value={3} max={4} label="3/4" />)
    expect(lbl.textContent).toContain('3/4')
  })

  it('SortHeader toggles direction on click', () => {
    const setSort = vi.fn()
    const { container } = render(
      <table><thead><tr>
        <SortHeader col="name" label="Name" sort={{ col: 'name', dir: 'asc' }} setSort={setSort} />
      </tr></thead></table>,
    )
    const th = container.querySelector('th')
    expect(th?.classList.contains('sorted')).toBe(true) // active column
    expect(th?.textContent).toContain('↑')              // asc glyph
    fireEvent.click(th)
    expect(setSort).toHaveBeenCalled()
  })

  it('StatusSelect renders its options and reports changes', () => {
    const onChange = vi.fn()
    const { container } = render(<StatusSelect value="To Do" onChange={onChange} />)
    const select = container.querySelector('select')
    expect(select?.value).toBe('To Do')
    expect(container.querySelectorAll('option').length).toBeGreaterThan(3)
    fireEvent.change(select, { target: { value: 'Done' } })
    expect(onChange).toHaveBeenCalledWith('Done')
  })

  it('ProjectChip resolves a project from context (and renders nothing for unknown ids)', () => {
    const value = { data: { PROJECTS: [{ id: 'p1', name: 'Platform', color: '#abc' }] } }
    const { container } = render(
      <NexusDataProvider value={value}><ProjectChip id="p1" /></NexusDataProvider>,
    )
    expect(container.textContent).toContain('Platform')

    const { container: empty } = render(
      <NexusDataProvider value={value}><ProjectChip id="nope" /></NexusDataProvider>,
    )
    expect(empty.querySelector('.pill')).toBeNull()
  })

  it('Drawer reads its persisted width from the namespaced storage key', () => {
    const store = { 'helm.ui.drawerWidth': '720' }
    const writes = []
    const storage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); writes.push(k) },
      removeItem: (k) => { delete store[k] },
    }
    // namespace 'helm' + identity getProfileKey → key "helm.ui.drawerWidth"
    const value = { data: {}, storage, getProfileKey: (k) => k, namespace: 'helm' }
    const { container } = render(
      <NexusDataProvider value={value}>
        <Drawer open title="Details"><p>body</p></Drawer>
      </NexusDataProvider>,
    )
    const panel = container.querySelector('.drawer.open')
    expect(panel).toBeTruthy()
    expect(panel.style.width).toBe('720px')   // seeded width applied (not phone)
    expect(container.textContent).toContain('Details')
    expect(container.textContent).toContain('body')
  })

  it('Drawer clamps an out-of-range persisted width into [280, 2000]', () => {
    const storage = {
      getItem: () => '99999',
      setItem: () => {},
      removeItem: () => {},
    }
    const value = { data: {}, storage, getProfileKey: (k) => k, namespace: 'nexusmd' }
    const { container } = render(
      <NexusDataProvider value={value}><Drawer open title="X" /></NexusDataProvider>,
    )
    expect(container.querySelector('.drawer.open').style.width).toBe('2000px')
  })

  it('Drawer renders headerContent instead of title/badges when provided', () => {
    const value = { data: {}, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, getProfileKey: (k) => k, namespace: 'nexusmd' }
    const { container } = render(
      <NexusDataProvider value={value}>
        <Drawer open title="Should not show" headerContent={<span>Custom header</span>}><p>body</p></Drawer>
      </NexusDataProvider>,
    )
    expect(container.textContent).toContain('Custom header')
    expect(container.textContent).not.toContain('Should not show')
  })

  it('Drawer uses defaultWidth as the initial width when nothing is stored', () => {
    const value = { data: {}, storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, getProfileKey: (k) => k, namespace: 'nexusmd' }
    const { container } = render(
      <NexusDataProvider value={value}>
        <Drawer open title="X" defaultWidth={820} />
      </NexusDataProvider>,
    )
    expect(container.querySelector('.drawer.open').style.width).toBe('820px')
  })
})

describe('useSeenTracking', () => {
  // Harness: renders the hook and exposes its return value via a callback,
  // since there's no renderHook helper wired up in this repo's test setup.
  function Harness({ categories, dataLoaded, deps, onResult }) {
    const result = useSeenTracking(categories, dataLoaded, deps)
    onResult(result)
    return null
  }

  function makeStorage(seed = {}) {
    const store = { ...seed }
    return {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    }
  }

  const identityDeps = (storage) => ({ storage, getProfileKey: (k) => k })

  const workCategory = (items) => ({
    work:   { items, fingerprint: (x) => `${x.id}|${x.state}` },
    pr:     { items: [], fingerprint: (x) => `${x.id}|${x.status}` },
    builds: { items: [], fingerprint: (x) => `${x.id}|${x.status}` },
    tests:  { items: [], fingerprint: (x) => `${x.id}|${x.result}` },
  })

  function renderTracking({ categories, dataLoaded, storage }) {
    let captured
    render(<Harness categories={categories} dataLoaded={dataLoaded} deps={identityDeps(storage)} onResult={(r) => { captured = r }} />)
    return captured
  }

  it('marks a brand-new item as unseen', () => {
    const storage = makeStorage()
    const result = renderTracking({ categories: workCategory([{ id: '1', state: 'Active' }]), dataLoaded: true, storage })
    expect(result.unseenIds.work.has('1')).toBe(true)
    expect(result.unseenCounts.work).toBe(1)
  })

  it('does not flag an item whose fingerprint is unchanged from the persisted seen map', () => {
    const storage = makeStorage({ helm_seen_work: JSON.stringify({ '1': '1|Active' }) })
    const result = renderTracking({ categories: workCategory([{ id: '1', state: 'Active' }]), dataLoaded: true, storage })
    expect(result.unseenIds.work.has('1')).toBe(false)
    expect(result.unseenCounts.work).toBe(0)
  })

  it('flags an item as unseen again when its tracked field changes', () => {
    const storage = makeStorage({ helm_seen_work: JSON.stringify({ '1': '1|Active' }) })
    const result = renderTracking({ categories: workCategory([{ id: '1', state: 'Done' }]), dataLoaded: true, storage })
    expect(result.unseenIds.work.has('1')).toBe(true)
    expect(result.unseenCounts.work).toBe(1)
  })

  it('does nothing while dataLoaded is false, even with items present', () => {
    const storage = makeStorage()
    const result = renderTracking({ categories: workCategory([{ id: '1', state: 'Active' }]), dataLoaded: false, storage })
    expect(result.unseenIds.work.size).toBe(0)
    expect(result.unseenCounts.work).toBe(0)
    expect(storage.getItem('helm_seen_work')).toBeNull()
  })

  it('does not resurrect false positives when data loads empty before loading for real (the race)', () => {
    const storage = makeStorage({ helm_seen_work: JSON.stringify({ '1': '1|Active', '2': '2|Active' }) })
    // First render: not loaded yet, items happen to be empty (placeholder state).
    const { rerender } = render(
      <Harness categories={workCategory([])} dataLoaded={false} deps={identityDeps(storage)} onResult={() => {}} />,
    )
    // Second render: real data has now loaded, matching the persisted seen map.
    let result
    rerender(
      <Harness
        categories={workCategory([{ id: '1', state: 'Active' }, { id: '2', state: 'Active' }])}
        dataLoaded
        deps={identityDeps(storage)}
        onResult={(r) => { result = r }}
      />,
    )
    expect(result.unseenCounts.work).toBe(0)
  })

  it('prunes ids no longer present in the current dataset from the persisted map', () => {
    const storage = makeStorage({ helm_seen_work: JSON.stringify({ '1': '1|Active', '2': '2|Active' }) })
    renderTracking({ categories: workCategory([{ id: '1', state: 'Active' }]), dataLoaded: true, storage })
    expect(JSON.parse(storage.getItem('helm_seen_work'))).toEqual({ '1': '1|Active' })
  })

  it('markSeen persists current fingerprints and clears unseen state for that category', () => {
    const storage = makeStorage()
    let result
    const categories = workCategory([{ id: '1', state: 'Active' }])
    const deps = identityDeps(storage)
    const { rerender } = render(<Harness categories={categories} dataLoaded deps={deps} onResult={(r) => { result = r }} />)
    expect(result.unseenCounts.work).toBe(1)
    result.markSeen('work')
    rerender(<Harness categories={categories} dataLoaded deps={deps} onResult={(r) => { result = r }} />)
    expect(result.unseenCounts.work).toBe(0)
    expect(JSON.parse(storage.getItem('helm_seen_work'))).toEqual({ '1': '1|Active' })
  })

  it('scopes persisted keys through the supplied getProfileKey', () => {
    const storage = makeStorage()
    renderTracking({
      categories: workCategory([{ id: '1', state: 'Active' }]),
      dataLoaded: true,
      storage,
    })
    // identityDeps uses (k) => k, so the raw key is used; assert the raw key was written.
    expect(storage.getItem('helm_seen_work')).toBeNull() // no markSeen call yet, only diffed
    let result
    render(<Harness categories={workCategory([{ id: '1', state: 'Active' }])} dataLoaded deps={{ storage, getProfileKey: (k) => `profileA.${k}` }} onResult={(r) => { result = r }} />)
    result.markSeen('work')
    expect(storage.getItem('profileA.helm_seen_work')).toBeTruthy()
  })
})
