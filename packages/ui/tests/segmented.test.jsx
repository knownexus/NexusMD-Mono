import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { Segmented } from '../src/segmented.jsx'

afterEach(cleanup)
const options = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]

describe('Segmented', () => {
  it('marks the value as the selected tab', () => {
    const { getByRole } = render(<Segmented options={options} value="b" onChange={() => {}} ariaLabel="Pick" />)
    expect(getByRole('tablist', { name: 'Pick' })).toBeTruthy()
    expect(getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true')
    expect(getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('false')
  })

  it('calls onChange with the id of the clicked tab', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<Segmented options={options} value="a" onChange={onChange} ariaLabel="Pick" />)
    fireEvent.click(getByRole('tab', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
