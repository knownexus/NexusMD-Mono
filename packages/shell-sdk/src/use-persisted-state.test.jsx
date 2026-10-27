import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { usePersistedState } from './use-persisted-state.js'

function Counter() {
  const [n, setN] = usePersistedState('nexusmd.test.count', 0)
  return <button onClick={() => setN(n + 1)}>{`count ${n}`}</button>
}

beforeEach(() => { cleanup(); localStorage.clear() })

describe('usePersistedState', () => {
  it('starts from the initial value and saves changes', () => {
    render(<Counter />)
    fireEvent.click(screen.getByText('count 0'))
    expect(screen.getByText('count 1')).toBeTruthy()
    const saved = Object.entries(localStorage).find(([k]) => k.includes('nexusmd.test.count'))
    expect(JSON.parse(saved[1])).toBe(1)
  })
  it('restores the saved value on the next mount', () => {
    const { unmount } = render(<Counter />)
    fireEvent.click(screen.getByText('count 0'))
    unmount()
    render(<Counter />)
    expect(screen.getByText('count 1')).toBeTruthy()
  })
  it('falls back to the initial value when the saved text is not JSON', () => {
    render(<Counter />)
    const key = Object.keys(localStorage).find(k => k.includes('nexusmd.test.count'))
    cleanup()
    localStorage.setItem(key, '{oops')
    render(<Counter />)
    expect(screen.getByText('count 0')).toBeTruthy()
  })
})
