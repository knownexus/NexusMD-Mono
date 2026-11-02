import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { WIDGET_TYPES } from '@nexusmd/ui'
import { DashboardGrid, useDisplay } from './dashboard-grid.jsx'

afterEach(cleanup)

const display = (pw, ph, scale = 1) => ({ id: `${pw}`, width: Math.round(pw / scale), height: Math.round(ph / scale), scaleFactor: scale, physicalWidth: pw, physicalHeight: ph })
const cards = [
  { id: 'review', title: 'Needs your review', span: 1, render: () => <div>review card</div>, onHide: vi.fn() },
  { id: 'team', title: 'Team', span: 2, render: () => <div>team card</div> },
]
const widgets = [{ id: 'n1', type: 'notes', config: {} }]
const grid = props => render(<DashboardGrid cards={cards} widgets={widgets} widgetTypes={WIDGET_TYPES} width={1600} display={display(1920, 1080)} {...props} />)

describe('DashboardGrid', () => {
  it('shows the cards and the added widgets, each with a grip, in the columns of the screen', () => {
    const { container } = grid()
    expect(screen.getAllByTestId('dash-cell').map(c => c.dataset.key)).toEqual(['card:review', 'card:team', 'w:n1'])
    expect(screen.getAllByLabelText('Drag to move')).toHaveLength(3)
    expect(container.querySelector('.dash-grid').dataset).toMatchObject({ screen: '1920x1080', cols: '6' })
    expect(screen.getByText(/Layout for this 1920×1080 screen \(not arranged yet\)/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reset layout' })).toBeNull()
  })

  it("a card's × hides it", () => {
    grid()
    fireEvent.click(screen.getByRole('button', { name: 'Hide Needs your review' }))
    expect(cards[0].onHide).toHaveBeenCalledWith('review')
  })

  it("uses the screen's own layout, and Reset layout clears only that screen", () => {
    const onLayoutsChange = vi.fn()
    const layouts = {
      '1920x1080': { cols: 6, items: [{ i: 'card:review', x: 0, y: 0, w: 6, h: 4 }] },
      '3840x1600': { cols: 12, items: [] },
    }
    const { container } = grid({ layouts, onLayoutsChange })
    expect(screen.getByText(/Layout for this 1920×1080 screen$/)).toBeTruthy()
    const review = container.querySelector('[data-key="card:review"]')
    // Full width: 6 of 6 columns.
    expect(review.style.width).toBe('1600px')
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
    expect(onLayoutsChange).toHaveBeenCalledWith({ '3840x1600': { cols: 12, items: [] } })
  })

  it('another screen gets its own columns', () => {
    const { container } = grid({ display: display(3840, 2160, 1.5) })
    expect(container.querySelector('.dash-grid').dataset).toMatchObject({ screen: '3840x2160', cols: '8' })
  })

  it('stacks in one column, without grips, in a narrow window', () => {
    const { container } = grid({ width: 700 })
    expect(container.querySelector('.dash-stack')).toBeTruthy()
    expect(screen.queryAllByLabelText('Drag to move')).toHaveLength(0)
    expect(screen.getAllByTestId('dash-cell')).toHaveLength(3)
  })
})

describe('useDisplay', () => {
  function Show({ host }) {
    const d = useDisplay(host)
    return <div data-testid="d">{d ? `${d.physicalWidth}x${d.physicalHeight}` : 'none'}</div>
  }

  it('reads the screen from the host and follows it to another one', async () => {
    let fire
    const off = vi.fn()
    const host = { display: { get: () => Promise.resolve(display(3840, 1600)), onChange: cb => { fire = cb; return off } } }
    const { unmount } = render(<Show host={host} />)
    expect(await screen.findByText('3840x1600')).toBeTruthy()
    act(() => fire(display(1920, 1080)))
    expect(screen.getByTestId('d').textContent).toBe('1920x1080')
    unmount()
    expect(off).toHaveBeenCalled()
  })

  it('falls back to a 1080p screen without a host display', () => {
    render(<Show host={{}} />)
    expect(screen.getByTestId('d').textContent).toBe('1920x1080')
  })
})
