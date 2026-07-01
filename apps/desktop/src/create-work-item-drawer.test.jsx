import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FieldInput } from './create-work-item-drawer.jsx'

describe('FieldInput', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders a select with allowedValues for a picklist field', () => {
    const def = { referenceName: 'Microsoft.VSTS.Common.Priority', name: 'Priority', dataType: 'integer', allowedValues: [1, 2, 3, 4], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: [], iterations: [] }} />)
    const select = screen.getByLabelText('Priority')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(5) // 4 values + blank
  })

  it('renders a team select for an identity field', () => {
    const def = { referenceName: 'System.AssignedTo', name: 'Assigned To', dataType: 'string', allowedValues: [], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[{ id: '1', name: 'Alex' }]} paths={{ areas: [], iterations: [] }} />)
    expect(screen.getByLabelText('Assigned To').tagName).toBe('SELECT')
    expect(screen.getByText('Alex')).toBeTruthy()
  })

  it('renders a datalist-backed input for a treePath field', () => {
    const def = { referenceName: 'System.AreaPath', name: 'Area Path', dataType: 'treePath', allowedValues: [], alwaysRequired: false }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: ['ProjectA\\Team1'], iterations: [] }} />)
    const input = screen.getByLabelText('Area Path')
    expect(input.getAttribute('list')).toBeTruthy()
  })

  it('calls onChange with the new value for a text field', () => {
    const def = { referenceName: 'Custom.Notes', name: 'Notes', dataType: 'string', allowedValues: [], alwaysRequired: false }
    const onChange = vi.fn()
    render(<FieldInput def={def} value="" onChange={onChange} team={[]} paths={{ areas: [], iterations: [] }} />)
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'hello' } })
    expect(onChange).toHaveBeenCalledWith('hello')
  })

  it('shows a required marker when alwaysRequired is true', () => {
    const def = { referenceName: 'System.Title', name: 'Title', dataType: 'string', allowedValues: [], alwaysRequired: true }
    render(<FieldInput def={def} value="" onChange={() => {}} team={[]} paths={{ areas: [], iterations: [] }} />)
    expect(screen.getByText('Title *')).toBeTruthy()
  })
})
