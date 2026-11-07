import React from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { GitTopbar, ModeSwitch, githubMode, useTopbarShowsMode } from './github-mode.jsx'
import { gitBar, BLANK_BAR } from '../git-bar.jsx'

afterEach(() => { cleanup(); githubMode.reset(); gitBar.reset() })

describe('the Local / GitHub switch in the top bar', () => {
  it('shows nothing on other screens', () => {
    githubMode.publish({ available: true, onGithub: false, request: vi.fn() })
    const { container } = render(<GitTopbar view="work" />)
    expect(container.textContent).toBe('')
  })

  it('shows nothing on Git Workspace while GitHub is not connected', () => {
    githubMode.publish({ available: false, onGithub: false, request: vi.fn() })
    render(<GitTopbar view="git" />)
    expect(screen.queryByRole('tablist', { name: 'Git Workspace view' })).toBeNull()
  })

  it('switches between Local and GitHub through the page, which can refuse', () => {
    const request = vi.fn()
    githubMode.publish({ available: true, onGithub: false, request })
    render(<GitTopbar view="git" />)
    const list = screen.getByRole('tablist', { name: 'Git Workspace view' })
    expect(screen.getByRole('tab', { name: 'Local' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'GitHub' }))
    expect(request).toHaveBeenCalledWith('github')
    expect(list).toBeTruthy()
  })

  it('follows the page when it switches to GitHub', () => {
    githubMode.publish({ available: true, onGithub: false, request: vi.fn() })
    render(<GitTopbar view="git" />)
    act(() => githubMode.publish({ available: true, onGithub: true, request: vi.fn() }))
    expect(screen.getByRole('tab', { name: 'GitHub' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('the page controls in the top bar', () => {
  it('draws the published page controls beside the switch on Git Workspace', () => {
    githubMode.publish({ available: true, onGithub: false, request: vi.fn() })
    gitBar.publish({ ...BLANK_BAR, active: true, canJump: true, pullCount: 2, onPullAll: vi.fn() })
    render(<GitTopbar view="git" />)
    expect(screen.getByRole('tab', { name: 'GitHub' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pull all (2)' })).toBeTruthy()
  })

  it('draws the controls even when GitHub is not connected, but not on other screens', () => {
    gitBar.publish({ ...BLANK_BAR, active: true, canJump: true })
    const { rerender } = render(<GitTopbar view="git" />)
    expect(screen.getByRole('button', { name: /Jump to branch/ })).toBeTruthy()
    expect(screen.queryByRole('tablist', { name: 'Git Workspace view' })).toBeNull()
    rerender(<GitTopbar view="work" />)
    expect(screen.queryByRole('button', { name: /Jump to branch/ })).toBeNull()
  })

  it('draws nothing once the page has gone', () => {
    gitBar.publish({ ...BLANK_BAR, active: true, canJump: true })
    render(<GitTopbar view="git" />)
    act(() => gitBar.reset())
    expect(screen.queryByRole('button', { name: /Jump to branch/ })).toBeNull()
  })
})

describe('where the switch lives', () => {
  function Probe() { return <span>{useTopbarShowsMode() ? 'top bar' : 'page'}</span> }

  it('is on the page until a shell that names the view renders the top bar switch', () => {
    render(<Probe />)
    expect(screen.getByText('page')).toBeTruthy()
    // An older shell renders the slot without a view: the switch stays on the page.
    render(<GitTopbar />)
    expect(screen.getByText('page')).toBeTruthy()
    render(<GitTopbar view="dashboard" />)
    expect(screen.getByText('top bar')).toBeTruthy()
  })

  it('renders on the page as the same switch', () => {
    const request = vi.fn()
    render(<ModeSwitch onGithub request={request} />)
    expect(screen.getByRole('tab', { name: 'GitHub' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Local' }))
    expect(request).toHaveBeenCalledWith('local')
  })
})
