import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { JsonPretty } from '../src/json-pretty.jsx'

afterEach(cleanup)

describe('JsonPretty', () => {
  it('renders a collapsible tree for valid JSON', () => {
    const { container, getByText } = render(<JsonPretty text={JSON.stringify({ name: 'Ada', active: true })} />)
    expect(getByText('"Ada"')).toBeTruthy()
    expect(container.textContent).toContain('active')
  })

  it('falls back to a plain <pre> block for non-JSON text', () => {
    const { container } = render(<JsonPretty text="<xml><a/></xml>" />)
    const pre = container.querySelector('pre')
    expect(pre).toBeTruthy()
    expect(pre.textContent).toBe('<xml><a/></xml>')
  })

  it('collapses a nested node on toggle click', () => {
    const { container, getByText } = render(<JsonPretty text={JSON.stringify({ a: { b: 1 } })} />)
    expect(getByText('1')).toBeTruthy()
    const toggles = container.querySelectorAll('button')
    fireEvent.click(toggles[1]) // the nested { b: 1 } object's own toggle
    expect(container.textContent).toContain('…')
  })

  it('renders an empty array without a toggle', () => {
    const { container } = render(<JsonPretty text={JSON.stringify({ items: [] })} />)
    expect(container.textContent).toContain('[]')
  })

  it('treats an empty string as non-JSON (falls back to an empty <pre>)', () => {
    const { container } = render(<JsonPretty text="" />)
    expect(container.querySelector('pre')).toBeTruthy()
  })
})
