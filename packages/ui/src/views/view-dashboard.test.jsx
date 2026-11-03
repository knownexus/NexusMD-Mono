import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DashboardView } from './view-dashboard.jsx'

afterEach(cleanup)

const base = { onOpenItem: vi.fn(), onOpenPR: vi.fn(), widgetOrder: ['review', 'team', 'activity'], setWidgetOrder: vi.fn(), quickLinks: [], team: [] }

describe('DashboardView widgets', () => {
  it('lays the cards out in its own grid by default', () => {
    const { container } = render(<DashboardView {...base} />)
    expect(container.querySelectorAll('.widget-grab').length).toBe(3)
  })

  it('draws its head (greeting, buttons, stats) above the cards by default', () => {
    const { container } = render(<DashboardView {...base} />)
    expect(container.querySelector('.page-head .dash-greeting h1')).toBeTruthy()
    expect(container.querySelector('.page-head .page-head-actions')).toBeTruthy()
    expect(container.querySelectorAll('.stats > *').length).toBeGreaterThanOrEqual(4)
  })

  it("hands its head's parts and the shown cards, in order, to renderWidgets instead", () => {
    const renderWidgets = vi.fn(cards => <div data-testid="custom">{cards.map(c => c.id).join(',')}</div>)
    const { container } = render(<DashboardView {...base} offViews={['team']} renderWidgets={renderWidgets} />)
    // No quick links set, so no quick-links part; Team is switched off, so neither its stat nor its card.
    expect(screen.getByTestId('custom').textContent)
      .toBe('page-greeting,page-actions,stat-prs,stat-active,stat-review,stat-blockers,review,activity')
    expect(container.querySelector('.page-head')).toBeNull()
    expect(container.querySelectorAll('.widget-grab').length).toBe(0)
    const all = renderWidgets.mock.calls.at(-1)[0]
    const greeting = all.find(c => c.id === 'page-greeting')
    expect(greeting).toMatchObject({ bare: true, top: true, frac: 0.5 })
    expect(greeting.onHide).toBeUndefined()
    const { container: drawn } = render(greeting.render())
    expect(drawn.querySelector('h1')).toBeTruthy()
    const review = all.find(c => c.id === 'review')
    expect(review).toMatchObject({ id: 'review', title: 'Needs your review', span: 1 })
    expect(typeof review.render).toBe('function')
    review.onHide('review')
    expect(base.setWidgetOrder).toHaveBeenCalledWith(['team', 'activity'])
  })
})
