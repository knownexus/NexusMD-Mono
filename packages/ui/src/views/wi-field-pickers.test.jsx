import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TagInput, AreaTreePicker } from './wi-field-pickers.jsx'

afterEach(cleanup)

describe('TagInput', () => {
  it('renders existing tags as chips', () => {
    render(<TagInput value="alpha; beta" onChange={vi.fn()} knownTags={[]} />)
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
  })

  it('adds a new tag on Enter and calls onChange with the joined string', () => {
    const onChange = vi.fn()
    render(<TagInput value="alpha" onChange={onChange} knownTags={[]} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'gamma' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('alpha; gamma')
  })

  it('removes a tag when its × is clicked', () => {
    const onChange = vi.fn()
    render(<TagInput value="alpha; beta" onChange={onChange} knownTags={[]} />)
    fireEvent.mouseDown(screen.getAllByText('×')[0])
    expect(onChange).toHaveBeenCalledWith('beta')
  })
})

describe('AreaTreePicker', () => {
  const areas = [
    { id: 'a', name: 'Alpha', items: ['leaf1'], children: [] },
  ]

  it('shows "— None —" when nothing is selected', () => {
    render(<AreaTreePicker value="" onChange={vi.fn()} areas={areas} />)
    expect(screen.getByText('— None —')).toBeTruthy()
  })

  it('opens the tree and selects a top-level node on click', () => {
    const onChange = vi.fn()
    render(<AreaTreePicker value="" onChange={onChange} areas={areas} />)
    fireEvent.click(screen.getByText('— None —'))
    fireEvent.mouseDown(screen.getByText('Alpha'))
    expect(onChange).toHaveBeenCalledWith('Alpha')
  })

  it('renders a chip for an already-selected path', () => {
    render(<AreaTreePicker value="Alpha" onChange={vi.fn()} areas={areas} />)
    expect(screen.getByText('Alpha')).toBeTruthy()
  })
})
