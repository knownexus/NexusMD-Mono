import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PathBar } from './path-bar.jsx'

afterEach(cleanup)

describe('PathBar', () => {
  it('shows every segment as a crumb, with › between and the last one marked as the current', () => {
    render(<PathBar segments={['Repo', 'src', 'app.jsx']} />)
    const nav = screen.getByRole('navigation', { name: 'File path' })
    expect(nav.textContent).toBe('Repo›src›app.jsx')
    expect(screen.getByText('app.jsx').getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('src').getAttribute('aria-current')).toBeNull()
  })

  it('draws its children on the right', () => {
    render(<PathBar segments={['a']}><button>File</button></PathBar>)
    expect(screen.getByRole('button', { name: 'File' })).toBeTruthy()
  })

  it('has the full path in the title, for a path too long to show', () => {
    render(<PathBar segments={['Repo', 'a', 'b']} />)
    expect(screen.getByRole('navigation', { name: 'File path' }).getAttribute('title')).toBe('Repo/a/b')
  })
})
