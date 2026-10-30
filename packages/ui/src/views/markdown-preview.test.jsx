// Text size for rendered markdown: one size for every preview, changed by the A−/A+ controls or
// Ctrl+scroll, and remembered.
import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MarkdownPreview, TextSizeControls, useMarkdownTextSize, stepTextSize, TEXT_SIZES } from './markdown-preview.jsx'

function Viewer({ label }) {
  const [size, setSize] = useMarkdownTextSize()
  return (
    <section aria-label={label}>
      <TextSizeControls size={size} onChange={setSize} />
      <MarkdownPreview markdown="# Title" aria-label={`${label} preview`} />
    </section>
  )
}

const sizeOf = label => screen.getByLabelText(`${label} preview`).style.fontSize

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('stepTextSize', () => {
  it('steps through the sizes and stops at either end', () => {
    expect(stepTextSize(100, 1)).toBe(110)
    expect(stepTextSize(100, -1)).toBe(90)
    expect(stepTextSize(TEXT_SIZES[0], -1)).toBe(TEXT_SIZES[0])
    expect(stepTextSize(TEXT_SIZES.at(-1), 1)).toBe(TEXT_SIZES.at(-1))
    expect(stepTextSize(123, 1)).toBe(110)
  })
})

describe('text size', () => {
  it('starts at 100%, and A+, A− and the reset change it', () => {
    render(<Viewer label="One" />)
    expect(sizeOf('One')).toBe('100%')
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }))
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }))
    expect(sizeOf('One')).toBe('125%')
    expect(screen.getByRole('button', { name: 'Reset text size' }).textContent).toBe('125%')
    fireEvent.click(screen.getByRole('button', { name: 'Smaller text' }))
    expect(sizeOf('One')).toBe('110%')
    fireEvent.click(screen.getByRole('button', { name: 'Reset text size' }))
    expect(sizeOf('One')).toBe('100%')
  })

  it('is one size for every preview showing, and is remembered', () => {
    render(<><Viewer label="One" /><Viewer label="Two" /></>)
    fireEvent.click(screen.getAllByRole('button', { name: 'Larger text' })[0])
    expect(sizeOf('Two')).toBe('110%')
    cleanup()
    render(<Viewer label="Later" />)
    expect(sizeOf('Later')).toBe('110%')
  })

  it('ignores a remembered size that is not one of the sizes', () => {
    localStorage.setItem('nexusmd.markdown.textSize', '9999')
    render(<Viewer label="One" />)
    expect(sizeOf('One')).toBe('100%')
  })

  it('changes with Ctrl+scroll over the preview, and leaves plain scrolling alone', () => {
    render(<Viewer label="One" />)
    const el = screen.getByLabelText('One preview')
    expect(fireEvent.wheel(el, { deltaY: -100 })).toBe(true)
    expect(sizeOf('One')).toBe('100%')
    // Not cancelled by default would mean the page zooms too.
    expect(fireEvent.wheel(el, { deltaY: -100, ctrlKey: true })).toBe(false)
    expect(sizeOf('One')).toBe('110%')
    fireEvent.wheel(el, { deltaY: 100, ctrlKey: true })
    fireEvent.wheel(el, { deltaY: 100, ctrlKey: true })
    expect(sizeOf('One')).toBe('90%')
  })

  it('stops at the smallest and largest sizes', () => {
    render(<Viewer label="One" />)
    const smaller = screen.getByRole('button', { name: 'Smaller text' })
    for (let i = 0; i < TEXT_SIZES.length; i++) fireEvent.click(smaller)
    expect(sizeOf('One')).toBe(`${TEXT_SIZES[0]}%`)
    expect(smaller.disabled).toBe(true)
  })
})
