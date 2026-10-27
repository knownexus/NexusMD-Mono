import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { VsCard } from './view-settings.jsx'

const KEY = 'nexusmd.settings.collapsed'
const header = name => screen.getByRole('button', { name: new RegExp(name) })

describe('VsCard collapsing', () => {
  beforeEach(() => localStorage.clear())
  afterEach(cleanup)

  it('starts expanded, collapses from its title bar, and remembers it', () => {
    render(<VsCard title="Logs" icon="log"><input aria-label="draft" /></VsCard>)
    expect(header('Logs').getAttribute('aria-expanded')).toBe('true')
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'half-typed' } })

    fireEvent.click(header('Logs'))
    expect(header('Logs').getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByLabelText('draft', { selector: 'input' }).closest('.card-body').hidden).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual(['Logs'])

    fireEvent.click(header('Logs'))
    expect(screen.getByLabelText('draft').value).toBe('half-typed')   // kept mounted while collapsed
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual([])
  })

  it('opens collapsed when it was left collapsed, and keeps other sections\' state', () => {
    localStorage.setItem(KEY, JSON.stringify(['Apps', 'Other']))
    render(<><VsCard title="Apps" icon="x">a</VsCard><VsCard title="Logs" icon="x">b</VsCard></>)
    expect(header('Apps').getAttribute('aria-expanded')).toBe('false')
    expect(header('Logs').getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(header('Logs'))
    expect(JSON.parse(localStorage.getItem(KEY)).sort()).toEqual(['Apps', 'Logs', 'Other'])
  })

  it('remembers by id when given one, and keeps header actions outside the toggle', () => {
    render(<VsCard id="profiles" title="Profiles" icon="x" actions={<button>New</button>}>body</VsCard>)
    fireEvent.click(header('Profiles'))
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual(['profiles'])
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy()   // still usable while collapsed
  })

  it('ignores an unreadable stored value', () => {
    localStorage.setItem(KEY, '{not json')
    render(<VsCard title="Logs" icon="x">b</VsCard>)
    expect(header('Logs').getAttribute('aria-expanded')).toBe('true')
  })
})
