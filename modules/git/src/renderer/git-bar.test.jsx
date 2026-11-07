import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { gitBar, GitTopbarControls, BLANK_BAR } from './git-bar.jsx'

afterEach(() => { cleanup(); gitBar.reset() })

const bar = over => ({ ...BLANK_BAR, active: true, canJump: true, fetchDisabled: false, onJump: vi.fn(), onFetchAll: vi.fn(), onPullAll: vi.fn(), onRefresh: vi.fn(), onToggleList: vi.fn(), ...over })

describe('the top bar controls', () => {
  it('shows the fetched status, Jump to branch, Fetch all and Pull all (N)', () => {
    const b = bar({ status: { text: 'Fetched 2 min ago', tone: 'ok' }, pullCount: 3 })
    render(<GitTopbarControls bar={b} />)
    expect(screen.getByText('Fetched 2 min ago')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Jump to branch/ }))
    expect(b.onJump).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch all' }))
    expect(b.onFetchAll).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Pull all (3)' }))
    expect(b.onPullAll).toHaveBeenCalledTimes(1)
  })

  it('disables Pull all (0) and says why', () => {
    render(<GitTopbarControls bar={bar({ pullCount: 0 })} />)
    const pull = screen.getByRole('button', { name: 'Pull all (0)' })
    expect(pull.disabled).toBe(true)
    expect(pull.title).toMatch(/No branch is behind/)
  })

  it('disables Jump to branch and Fetch all when there is no branch, with a reason', () => {
    render(<GitTopbarControls bar={bar({ canJump: false, fetchDisabled: true })} />)
    expect(screen.getByRole('button', { name: /Jump to branch/ }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Fetch all' }).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Fetch all' }).title).not.toBe('')
  })

  it('has Refresh and a Hide / Show repositories button', () => {
    const b = bar({ listHidden: false })
    const { rerender } = render(<GitTopbarControls bar={b} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(b.onRefresh).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Hide repositories' }))
    expect(b.onToggleList).toHaveBeenCalledTimes(1)
    rerender(<GitTopbarControls bar={{ ...b, listHidden: true }} />)
    expect(screen.getByRole('button', { name: 'Show repositories' })).toBeTruthy()
  })

  it('on GitHub shows only the repository note', () => {
    render(<GitTopbarControls bar={bar({ onGithub: true, repoNote: '2 repositories from Work\'s GitHub connection' })} />)
    expect(screen.getByText("2 repositories from Work's GitHub connection")).toBeTruthy()
    for (const name of [/Jump to branch/, 'Fetch all', /^Pull all/, 'Refresh', 'Hide repositories']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('does not redraw its subscribers for an equal publish', () => {
    const seen = vi.fn()
    const off = gitBar.subscribe(seen)
    const state = { ...BLANK_BAR, active: true, pullCount: 1 }
    gitBar.publish(state)
    gitBar.publish({ ...state })
    expect(seen).toHaveBeenCalledTimes(1)
    off()
  })
})

// jsdom does not load stylesheets, so the layout rules are read from the file.
describe('the top bar layout rules', () => {
  const css = readFileSync(join(__dirname, 'git-workspace.css'), 'utf8')
  // The declarations of the first rule whose selector is exactly `sel`.
  const rule = sel => {
    const start = css.split('\n').findIndex(line => line.startsWith(`${sel} {`))
    if (start < 0) return ''
    const line = css.split('\n')[start]
    return line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'))
  }

  it('is one 48px row that never wraps, so a long group name has to shrink', () => {
    const r = rule('.nx-gw-bar')
    expect(r).toMatch(/height:\s*48px/)
    expect(r).toMatch(/flex-wrap:\s*nowrap/)
  })

  it('lets the group picker shrink with an ellipsis instead of pushing the controls out', () => {
    expect(rule('.nx-gw-picker-btn .nx-gw-picker-name')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.nx-gw-picker-btn')).toMatch(/min-width:\s*0/)
  })
})
