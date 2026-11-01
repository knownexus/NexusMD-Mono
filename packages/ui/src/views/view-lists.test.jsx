import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ListsView } from './view-lists.jsx'

afterEach(cleanup)

const item = (id, url) => ({ id, title: 't' + id, url })

describe('ListsView (shared)', () => {
  it('renders anchors only for http(s) urls and plain text otherwise', () => {
    const data = { lists: [{ id: 'l1', name: 'L', fields: ['url'], statuses: ['Done'],
      items: [item('a', 'https://a.com/x'), item('b', 'javascript:alert(1)'), item('c', 42)] }] }
    const { container } = render(<ListsView data={data} onChange={() => {}} device="phone"/>)
    const anchors = container.querySelectorAll('a')
    expect(anchors).toHaveLength(1)
    expect(anchors[0].getAttribute('href')).toBe('https://a.com/x')
    expect(screen.getByText('javascript:alert(1)').tagName).not.toBe('A')
    expect(screen.getByText('42')).toBeTruthy()
  })

  it('does not throw on a list lacking items and fields, or on data lacking lists', () => {
    expect(() => render(<ListsView data={{ lists: [{ id: 'l1', name: 'Bare' }] }} onChange={() => {}}/>)).not.toThrow()
    cleanup()
    expect(() => render(<ListsView data={{}} onChange={() => {}}/>)).not.toThrow()
    expect(screen.getByText('Create a list to get started.')).toBeTruthy()
  })

  it('reports edits through onChange instead of writing storage', () => {
    const onChange = vi.fn()
    const data = { lists: [{ id: 'l1', name: 'L', fields: [], items: [{ id: 'i1', title: 'One' }] }] }
    render(<ListsView data={data} onChange={onChange} device="desktop"/>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete One' }))
    expect(onChange).toHaveBeenCalledWith({ lists: [{ id: 'l1', name: 'L', fields: [], items: [] }] })
  })

  it('uses the toast it is given and shows My items for the given displayName', () => {
    const toast = vi.fn()
    const data = { lists: [{ id: 'l1', name: 'L', fields: [], items: [{ id: 'i1', title: 'Mine', owner: 'Ann' }] }] }
    render(<ListsView data={data} onChange={() => {}} toast={toast} displayName="ann"/>)
    fireEvent.click(screen.getByText('+ New list'))
    fireEvent.click(screen.getByText('Save'))
    expect(toast).toHaveBeenCalledWith('List name is required.', 'error')
    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(screen.getByText('My items'))
    expect(screen.getAllByText('Mine').length).toBeGreaterThan(0)
  })
})
