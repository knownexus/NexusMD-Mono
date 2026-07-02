import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import {
  StateDot, Prio, FilterChip, CardFrame, Sparkline, Stat,
  Ring, SortHeader, StatusSelect, ProjectChip, Drawer, NexusDataProvider,
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
