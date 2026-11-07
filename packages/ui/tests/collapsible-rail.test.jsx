import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { CollapsibleRail, railColumns } from '../src/collapsible-rail.jsx'

afterEach(cleanup)

describe('CollapsibleRail', () => {
  it('closed, it is one strip button named Show <label> that calls onToggle and carries the vertical label', () => {
    const onToggle = vi.fn()
    const { getByRole, getByText, queryByText } = render(<CollapsibleRail open={false} onToggle={onToggle} label="Commit"><p>body</p></CollapsibleRail>)
    const strip = getByRole('button', { name: 'Show Commit' })
    expect(strip.getAttribute('aria-expanded')).toBe('false')
    expect(getByText('Commit')).toBeTruthy()
    expect(queryByText('body')).toBeNull()
    fireEvent.click(strip)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('open, it renders its children and a Hide panel button', () => {
    const onToggle = vi.fn()
    const { getByRole, getByText } = render(<CollapsibleRail open onToggle={onToggle} label="Commit"><p>body</p></CollapsibleRail>)
    expect(getByText('body')).toBeTruthy()
    fireEvent.click(getByRole('button', { name: 'Hide panel' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('railColumns gives the column width: 40px closed, the width open', () => {
    expect(railColumns(false, 290)).toBe('40px')
    expect(railColumns(true, 290)).toBe('290px')
  })
})
