// packages/ui/tests/field-visibility-card.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { FieldVisibilityCard } from '../src/index.js'

const CATALOG = [
  { key: 'title', label: 'Title', locked: true },
  { key: 'assignee', label: 'Assignee' },
  { key: 'tags', label: 'Tags' },
]

afterEach(cleanup)

describe('FieldVisibilityCard', () => {
  it('renders a row per catalog field with the locked row disabled', () => {
    const { getByLabelText } = render(
      <FieldVisibilityCard title="WI cards" catalog={CATALOG} config={[]} onChange={() => {}} />
    )
    expect(getByLabelText('Title').disabled).toBe(true)
    expect(getByLabelText('Assignee').disabled).toBe(false)
    expect(getByLabelText('Assignee').checked).toBe(true)
  })

  it('toggling a field calls onChange with that field hidden', () => {
    const onChange = vi.fn()
    const { getByLabelText } = render(
      <FieldVisibilityCard title="WI cards" catalog={CATALOG} config={[]} onChange={onChange} />
    )
    fireEvent.click(getByLabelText('Tags'))
    expect(onChange).toHaveBeenCalled()
    const next = onChange.mock.calls[0][0]
    expect(next.find(e => e.key === 'tags').visible).toBe(false)
  })

  it('Reset to defaults calls onChange with the default config', () => {
    const onChange = vi.fn()
    const { getByText } = render(
      <FieldVisibilityCard title="WI cards" catalog={CATALOG}
        config={[{ key: 'tags', visible: false }]} onChange={onChange} />
    )
    fireEvent.click(getByText('Reset to defaults'))
    expect(onChange).toHaveBeenCalledWith([
      { key: 'title', visible: true },
      { key: 'assignee', visible: true },
      { key: 'tags', visible: true },
    ])
  })
})
