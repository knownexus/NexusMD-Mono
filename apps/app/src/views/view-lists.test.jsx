import React from 'react'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { ListsView } from './view-lists.jsx'
import { getProfileKey } from '../profile-keys.js'

afterEach(() => { cleanup(); localStorage.clear() })

const seed = (lists) => localStorage.setItem(getProfileKey('helm.lists'), JSON.stringify({ lists }))
const item = (id, url) => ({ id, title: 't' + id, url })

describe('Lists view url fields', () => {
  it('renders anchors only for http(s) urls and plain text otherwise', () => {
    seed([{ id: 'l1', name: 'L', fields: ['url'], statuses: ['Done'],
      items: [item('a', 'https://a.com/x'), item('b', 'javascript:alert(1)'), item('c', 42)] }])
    const { container } = render(<ListsView />)
    const anchors = container.querySelectorAll('a')
    expect(anchors).toHaveLength(1)
    expect(anchors[0].getAttribute('href')).toBe('https://a.com/x')
    expect(screen.getByText('javascript:alert(1)').tagName).not.toBe('A')
    expect(screen.getByText('42')).toBeTruthy()
  })
  it('does not throw on a list lacking items and fields', () => {
    seed([{ id: 'l1', name: 'Bare' }])
    expect(() => render(<ListsView />)).not.toThrow()
  })
})

describe('Lists view sync', () => {
  it('a pulled sync update (nexusmd:sync-applied for lists) re-renders the new data; other collections are ignored', () => {
    seed([{ id: 'l1', name: 'Before', fields: [], statuses: ['Open'], items: [] }])
    render(<ListsView />)
    expect(screen.getAllByText('Before').length).toBeGreaterThan(0)
    seed([{ id: 'l1', name: 'After', fields: [], statuses: ['Open'], items: [] }])
    act(() => { document.dispatchEvent(new CustomEvent('nexusmd:sync-applied', { detail: { collId: 'tweaks' } })) })
    expect(screen.queryByText('After')).toBeNull()
    act(() => { document.dispatchEvent(new CustomEvent('nexusmd:sync-applied', { detail: { collId: 'lists' } })) })
    expect(screen.getAllByText('After').length).toBeGreaterThan(0)
    expect(screen.queryByText('Before')).toBeNull()
  })
})
