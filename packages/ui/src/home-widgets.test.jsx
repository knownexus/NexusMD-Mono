import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { WidgetHost, WidgetSheet } from './home-widgets.jsx'

afterEach(cleanup)

describe('WidgetHost', () => {
  it('shows nothing until a widget is added', () => {
    const { container } = render(<WidgetHost widgets={[]} ctx={{}} onEdit={() => {}}/>)
    expect(container.innerHTML).toBe('')
  })

  it('renders a Lists widget whose list was deleted as removed, without throwing', () => {
    const widgets = [{ id: 'a', type: 'lists', config: { listId: 'gone' } }]
    expect(() => render(<WidgetHost widgets={widgets} ctx={{ lists: [{ id: 'other', name: 'Other' }], navTo: () => {} }} onEdit={() => {}}/>)).not.toThrow()
    expect(screen.getByText('This list was removed.')).toBeTruthy()
    expect(screen.queryByText('Other')).toBeNull()
  })

  it('renders a Lists widget with no lists left (or malformed ones) as empty, without throwing', () => {
    const widgets = [{ id: 'a', type: 'lists', config: {} }]
    expect(() => render(<WidgetHost widgets={widgets} ctx={{ navTo: () => {} }} onEdit={() => {}}/>)).not.toThrow()
    expect(screen.getByText('No lists yet.')).toBeTruthy()
    cleanup()
    render(<WidgetHost widgets={widgets} ctx={{ lists: [null, { id: 'l1', name: 'Bare' }], navTo: () => {} }} onEdit={() => {}}/>)
    expect(screen.getByText('Bare')).toBeTruthy()
    expect(screen.getByText('0 items')).toBeTruthy()
  })

  it('skips a widget whose page is in offScreens', () => {
    const widgets = [{ id: 'a', type: 'builds', config: {} }, { id: 'b', type: 'lists', config: {} }]
    render(<WidgetHost widgets={widgets} offScreens={['builds']} ctx={{ lists: [], navTo: () => {} }} onEdit={() => {}}/>)
    expect(screen.queryByText('Builds')).toBeNull()
    expect(screen.getByText('Lists')).toBeTruthy()
  })

  it('reads builds from ctx and shows only as many as configured', () => {
    const builds = [1, 2, 3, 4].map(n => ({ id: n, pipeline: `P${n}`, status: 'success', branch: 'main' }))
    render(<WidgetHost widgets={[{ id: 'a', type: 'builds', config: { count: 2 } }]} ctx={{ builds, navTo: () => {} }} onEdit={() => {}}/>)
    expect(screen.queryByText('P3')).toBeNull()
    expect(screen.getByText('P2')).toBeTruthy()
  })
})

describe('WidgetSheet', () => {
  it('adds a widget set up as chosen', () => {
    const onSave = vi.fn()
    render(<WidgetSheet open widget={null} onClose={() => {}} onSave={onSave} onRemove={() => {}}/>)
    fireEvent.click(screen.getByText('Builds'))
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add widget' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'builds', config: expect.objectContaining({ count: 7 }) }))
  })

  it('offers repos from listRepoChoices and uses the Sheet it is given', async () => {
    const Sheet = ({ open, title, children }) => open ? <div data-testid="my-sheet"><h2>{title}</h2>{children}</div> : null
    const listRepoChoices = vi.fn(() => Promise.resolve({ repos: [{ id: 'r1', name: 'Repo One' }] }))
    render(<WidgetSheet open widget={null} Sheet={Sheet} listRepoChoices={listRepoChoices} onClose={() => {}} onSave={() => {}} onRemove={() => {}}/>)
    expect(screen.getByTestId('my-sheet')).toBeTruthy()
    fireEvent.click(screen.getByText('Repo'))
    expect(await screen.findByText('Repo One')).toBeTruthy()
  })
})
