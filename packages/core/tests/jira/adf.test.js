// packages/core/tests/jira/adf.test.js
import { describe, it, expect } from 'vitest'
import { htmlToAdf } from '../../src/modules/jira/adf.js'

const doc = (...content) => ({ type: 'doc', version: 1, content })
const p = (...content) => ({ type: 'paragraph', content })
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })

describe('htmlToAdf', () => {
  it('returns an empty doc for empty input', () => {
    expect(htmlToAdf('')).toEqual(doc())
    expect(htmlToAdf(null)).toEqual(doc())
  })

  it('converts paragraphs and trims edge whitespace', () => {
    expect(htmlToAdf('<p> Hello </p><p>World</p>')).toEqual(doc(p(t('Hello')), p(t('World'))))
  })

  it('converts headings with their level', () => {
    expect(htmlToAdf('<h2>Title</h2>')).toEqual(doc({ type: 'heading', attrs: { level: 2 }, content: [t('Title')] }))
  })

  it('applies inline marks, nesting them', () => {
    expect(htmlToAdf('<p><strong>a <em>b</em></strong> <u>c</u> <s>d</s></p>')).toEqual(doc(p(
      t('a ', [{ type: 'strong' }]),
      t('b', [{ type: 'strong' }, { type: 'em' }]),
      t(' '),
      t('c', [{ type: 'underline' }]),
      t(' '),
      t('d', [{ type: 'strike' }]),
    )))
  })

  it('keeps only link alongside code marks (ADF rule)', () => {
    expect(htmlToAdf('<p><strong><code>x</code></strong></p>')).toEqual(doc(p(t('x', [{ type: 'code' }]))))
  })

  it('converts links', () => {
    expect(htmlToAdf('<p><a href="https://x.io">site</a></p>'))
      .toEqual(doc(p(t('site', [{ type: 'link', attrs: { href: 'https://x.io' } }]))))
  })

  it('converts line breaks to hardBreak', () => {
    expect(htmlToAdf('<p>a<br>b<br/>c</p>')).toEqual(doc(p(t('a'), { type: 'hardBreak' }, t('b'), { type: 'hardBreak' }, t('c'))))
  })

  it('converts nested lists', () => {
    expect(htmlToAdf('<ul><li>one<ol><li>two</li></ol></li></ul>')).toEqual(doc({
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [
          p(t('one')),
          { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('two'))] }] },
        ],
      }],
    }))
  })

  it('converts code blocks preserving whitespace', () => {
    expect(htmlToAdf('<pre><code>a\n  b</code></pre>')).toEqual(doc({ type: 'codeBlock', content: [t('a\n  b')] }))
  })

  it('decodes entities', () => {
    expect(htmlToAdf('<p>a &amp; b &lt;c&gt; &#39;d&#39;</p>')).toEqual(doc(p(t("a & b <c> 'd'"))))
  })

  it('reduces unsupported elements to their text', () => {
    expect(htmlToAdf('<p><span style="color:red">red</span> <img src="x"></p><table><tr><td>cell</td></tr></table>'))
      .toEqual(doc(p(t('red')), p(t('cell'))))
  })

  it('wraps loose text in a paragraph', () => {
    expect(htmlToAdf('<div>loose <b>bold</b></div>')).toEqual(doc(p(t('loose '), t('bold', [{ type: 'strong' }]))))
  })

  it('treats tag-free input as plain text with paragraphs and line breaks', () => {
    expect(htmlToAdf('line 1\nline 2\n\npara 2')).toEqual(doc(
      p(t('line 1'), { type: 'hardBreak' }, t('line 2')),
      p(t('para 2')),
    ))
  })
})
