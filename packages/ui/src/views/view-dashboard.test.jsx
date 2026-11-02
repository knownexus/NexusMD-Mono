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

  it('hands the shown cards, in order, to renderWidgets instead', () => {
    const renderWidgets = vi.fn(cards => <div data-testid="custom">{cards.map(c => c.id).join(',')}</div>)
    const { container } = render(<DashboardView {...base} offViews={['team']} renderWidgets={renderWidgets} />)
    expect(screen.getByTestId('custom').textContent).toBe('review,activity')
    expect(container.querySelectorAll('.widget-grab').length).toBe(0)
    const [review] = renderWidgets.mock.calls.at(-1)[0]
    expect(review).toMatchObject({ id: 'review', title: 'Needs your review', span: 1 })
    expect(typeof review.render).toBe('function')
    review.onHide('review')
    expect(base.setWidgetOrder).toHaveBeenCalledWith(['team', 'activity'])
  })
})
