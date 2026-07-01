import { describe, it, expect } from 'vitest'
import { isOnlyStructural, stripStructural, renderContent } from './render-content.js'

describe('isOnlyStructural', () => {
  it('returns true for plain text with no tags', () => {
    expect(isOnlyStructural('## Heading\n**bold**')).toBe(true)
  })

  it('returns true for text wrapped in div/p', () => {
    expect(isOnlyStructural('<div><p>## Heading</p><p>**bold**</p></div>')).toBe(true)
  })

  it('returns true for br-separated content', () => {
    expect(isOnlyStructural('<div>Line 1<br/>Line 2</div>')).toBe(true)
  })

  it('returns true for self-closing br', () => {
    expect(isOnlyStructural('<p>A<br />B</p>')).toBe(true)
  })

  it('returns false when <b> tag present', () => {
    expect(isOnlyStructural('<div><b>bold</b> text</div>')).toBe(false)
  })

  it('returns false when <strong> tag present', () => {
    expect(isOnlyStructural('<strong>bold</strong>')).toBe(false)
  })

  it('returns false when anchor with href present', () => {
    expect(isOnlyStructural('<p>See <a href="https://example.com">link</a></p>')).toBe(false)
  })

  it('returns false when <ul>/<li> present', () => {
    expect(isOnlyStructural('<ul><li>item</li></ul>')).toBe(false)
  })

  it('returns false when h1–h6 tag present', () => {
    expect(isOnlyStructural('<h2>Heading</h2>')).toBe(false)
    expect(isOnlyStructural('<h6>Heading</h6>')).toBe(false)
  })

  it('returns false when <pre>/<code> present', () => {
    expect(isOnlyStructural('<pre><code>const x = 1</code></pre>')).toBe(false)
  })

  it('returns false when <em> present', () => {
    expect(isOnlyStructural('<em>italic</em>')).toBe(false)
  })

  it('returns false when <table> present', () => {
    expect(isOnlyStructural('<table><tr><td>cell</td></tr></table>')).toBe(false)
  })

  it('returns true for empty string', () => {
    expect(isOnlyStructural('')).toBe(true)
  })
})

describe('stripStructural', () => {
  it('strips div and p tags leaving content', () => {
    expect(stripStructural('<div><p>Hello world</p></div>')).toBe('Hello world')
  })

  it('converts </p> to newline', () => {
    const result = stripStructural('<p>Line 1</p><p>Line 2</p>')
    expect(result).toBe('Line 1\nLine 2')
  })

  it('converts <br> variants to newline', () => {
    expect(stripStructural('Line 1<br>Line 2')).toBe('Line 1\nLine 2')
    expect(stripStructural('Line 1<br/>Line 2')).toBe('Line 1\nLine 2')
    expect(stripStructural('Line 1<br />Line 2')).toBe('Line 1\nLine 2')
  })

  it('decodes &nbsp; to space', () => {
    expect(stripStructural('<p>Hello&nbsp;world</p>')).toBe('Hello world')
  })

  it('decodes common HTML entities', () => {
    expect(stripStructural('<p>&amp; &lt; &gt; &quot;</p>')).toBe('& < > "')
  })

  it('trims leading and trailing whitespace', () => {
    expect(stripStructural('<div>  Hello  </div>')).toBe('Hello')
  })

  it('preserves internal newlines from multiple paragraphs', () => {
    const result = stripStructural('<p>A</p><p>B</p>')
    expect(result).toBe('A\nB')
  })
})

describe('renderContent', () => {
  it('returns Not-set placeholder for empty string', () => {
    expect(renderContent('')).toContain('Not set')
  })

  it('returns Not-set placeholder for whitespace-only string', () => {
    expect(renderContent('   ')).toContain('Not set')
  })

  it('returns Not-set placeholder for null/undefined', () => {
    expect(renderContent(null)).toContain('Not set')
    expect(renderContent(undefined)).toContain('Not set')
  })

  it('returns HTML string for plain text (markdown path)', () => {
    // marked IS available as an npm dep in the test env
    const html = renderContent('**bold**')
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(0)
  })

  it('strips structural wrappers and parses as markdown for div/p wrapped content', () => {
    const html = renderContent('<div><p>**bold**</p></div>')
    // Should go through the markdown path, not preserve the div/p
    expect(html).not.toContain('<div>')
    expect(html).not.toContain('<p>**bold**</p>')
  })

  it('preserves real HTML formatting (sanitized HTML path)', () => {
    const html = renderContent('<p>See <a href="https://example.com">link</a></p>')
    expect(html).toContain('href')
  })
})
