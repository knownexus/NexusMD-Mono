import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
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
