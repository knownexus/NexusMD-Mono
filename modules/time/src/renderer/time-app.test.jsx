import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { TimeApp } from './time-app.jsx'

const tickets = [{ id: 'PAY-12', title: 'Fix refund rounding', source: 'jira' }]
const withWork = { capabilities: { has: n => n === 'work.items', call: () => tickets } }
const without = { capabilities: { has: () => false, call: () => { throw new Error('unavailable') } } }

describe('Time (desktop shell)', () => {
  it('offers the tickets Work provides', () => {
    render(<TimeApp host={withWork}/>)
    fireEvent.change(screen.getByLabelText('What are you working on'), { target: { value: 'refund' } })
    expect(screen.getByRole('option', { name: /PAY-12/ })).toBeTruthy()
  })

  it('still works as a plain timer when Work is not installed', () => {
    render(<TimeApp host={without}/>)
    fireEvent.change(screen.getByLabelText('What are you working on'), { target: { value: 'refund' } })
    expect(screen.queryByRole('option')).toBeNull()
    fireEvent.keyDown(screen.getByLabelText('What are you working on'), { key: 'Enter' })
    expect(screen.getByRole('region', { name: 'Running' }).textContent).toContain('refund')
  })

  it('keeps each profile\'s log under its own key', () => {
    render(<TimeApp host={without}/>)
    fireEvent.change(screen.getByLabelText('What are you working on'), { target: { value: 'planning' } })
    fireEvent.keyDown(screen.getByLabelText('What are you working on'), { key: 'Enter' })
    const key = Object.keys(localStorage).find(k => k.includes('nexusmd.timelog.v1'))
    expect(key).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(key)).entries[0].label).toBe('planning')
  })
})
