// @vitest-environment jsdom
// One Markdown syntax data set and one element-to-source table, shared by the desktop Markdown view
// (cheat sheet panel, toolbar, hover learn mode) and the phone (cheat sheet sheet, tap learn mode).
// These pin what each platform showed before the two copies were merged into one.
import { describe, it, expect } from 'vitest'
import { MD_CHEAT_GROUPS, CHEAT, LEARN_ELEMENTS, markdownSourceOf, learnTarget } from '../src/modules/markdown/extras.js'

const html = (markup) => { const root = document.createElement('div'); root.innerHTML = markup; return root }

// The desktop's CHEAT_GROUPS as it was in MarkdownViewer.jsx.
const DESKTOP = [
  { label: 'Text Formatting', items: [
    { label: 'Bold', learnKey: 'bold', syntax: '**text**', description: 'Make text bold', before: '**', after: '**', placeholder: 'bold text', inline: true },
    { label: 'Italic', learnKey: 'italic', syntax: '*text*', description: 'Make text italic', before: '*', after: '*', placeholder: 'italic text', inline: true },
    { label: 'Strikethrough', learnKey: 'strikethrough', syntax: '~~text~~', description: 'Strike through text', before: '~~', after: '~~', placeholder: 'strikethrough', inline: true },
    { label: 'Inline Code', learnKey: 'inline-code', syntax: '`code`', description: 'Inline code or variable names', before: '`', after: '`', placeholder: 'code', inline: true },
  ] },
  { label: 'Structure', items: [
    { label: 'H1', learnKey: 'heading', syntax: '# Heading 1', description: 'Top-level heading', before: '\n# ', after: '', placeholder: 'Heading 1', inline: false },
    { label: 'H2', learnKey: 'heading', syntax: '## Heading 2', description: 'Second-level heading', before: '\n## ', after: '', placeholder: 'Heading 2', inline: false },
    { label: 'H3', learnKey: 'heading', syntax: '### Heading 3', description: 'Third-level heading', before: '\n### ', after: '', placeholder: 'Heading 3', inline: false },
    { label: 'Blockquote', learnKey: 'blockquote', syntax: '> text', description: 'Indented quote block', before: '\n> ', after: '', placeholder: 'blockquote text', inline: false },
    { label: 'Horiz. Rule', learnKey: 'hr', syntax: '---', description: 'Horizontal divider line', before: '\n---\n', after: '', placeholder: '', inline: false },
  ] },
  { label: 'Lists', items: [
    { label: '• Bullet List', learnKey: 'bullet-list', syntax: '- item', description: 'Unordered list item', before: '\n- ', after: '', placeholder: 'list item', inline: false },
    { label: '1. Numbered', learnKey: 'numbered-list', syntax: '1. item', description: 'Ordered list item', before: '\n1. ', after: '', placeholder: 'list item', inline: false },
    { label: '☐ Task', learnKey: 'task-list', syntax: '- [ ] task', description: 'Checkbox task item', before: '\n- [ ] ', after: '', placeholder: 'task item', inline: false },
  ] },
  { label: 'Links & Media', items: [
    { label: 'Link', learnKey: 'link', syntax: '[text](url)', description: 'Clickable hyperlink', before: '[', after: '](url)', placeholder: 'link text', inline: true },
    { label: 'Image', learnKey: 'image', syntax: '![alt](url)', description: 'Embedded image', before: '![', after: '](image-url)', placeholder: 'alt text', inline: true },
  ] },
  { label: 'Code', items: [
    { label: 'Code Block', learnKey: 'code-block', syntax: '```lang\ncode\n```', description: 'Fenced code block with syntax highlighting', before: '\n```\n', after: '\n```\n', placeholder: 'code here', inline: false },
  ] },
  { label: 'Table', items: [
    { label: 'Table', learnKey: 'table', syntax: '| Col | Col |', description: '3-column table with header row', before: '\n| Header | Header | Header |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n', after: '', placeholder: '', inline: false },
  ] },
]

// The phone's CHEAT as it was in core.
const PHONE = [
  { group: 'Text', items: [
    { name: 'Bold', syntax: '**text**', note: 'Make text bold', format: 'Bold' },
    { name: 'Italic', syntax: '*text*', note: 'Make text italic', format: 'Italic' },
    { name: 'Strikethrough', syntax: '~~text~~', note: 'Strike through text', format: 'Strikethrough' },
    { name: 'Inline code', syntax: '`code`', note: 'Code or a variable name', format: 'Inline code' },
  ] },
  { group: 'Structure', items: [
    { name: 'Heading 1', syntax: '# Heading', note: 'Top-level heading', format: 'Heading 1' },
    { name: 'Heading 2', syntax: '## Heading', note: 'Second-level heading', format: 'Heading 2' },
    { name: 'Heading 3', syntax: '### Heading', note: 'Third-level heading', format: 'Heading 3' },
    { name: 'Quote', syntax: '> quote', note: 'Indented quote block', format: 'Quote' },
    { name: 'Divider', syntax: '---', note: 'Horizontal line', format: 'Divider' },
  ] },
  { group: 'Lists', items: [
    { name: 'Bullet list', syntax: '- item', note: 'Unordered list item', format: 'Bullet list' },
    { name: 'Numbered list', syntax: '1. item', note: 'Ordered list item', format: 'Numbered list' },
    { name: 'Task', syntax: '- [ ] task', note: 'Checkbox item', format: 'Task' },
  ] },
  { group: 'Links, media and code', items: [
    { name: 'Link', syntax: '[text](url)', note: 'A clickable link', format: 'Link' },
    { name: 'Image', syntax: '![alt](url)', note: 'An embedded image', format: 'Image' },
    { name: 'Code block', syntax: '```\ncode\n```', note: 'Fenced block of code', format: 'Code block' },
    { name: 'Table', syntax: '| a | b |\n| --- | --- |', note: 'A table with a header row', format: 'Table' },
  ] },
]

const DESKTOP_FIELDS = ['label', 'learnKey', 'syntax', 'description', 'before', 'after', 'placeholder', 'inline']
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]))

describe('one Markdown cheat-sheet data set', () => {
  it('gives the desktop the same groups and entries as before', () => {
    expect(MD_CHEAT_GROUPS.map(g => ({ label: g.label, items: g.items.map(i => pick(i, DESKTOP_FIELDS)) }))).toEqual(DESKTOP)
  })

  it('derives the phone cheat sheet from it, unchanged', () => {
    expect(CHEAT).toEqual(PHONE)
  })

  it('names a phone formatting chip for every entry', () => {
    for (const g of MD_CHEAT_GROUPS) for (const i of g.items) expect(typeof i.format).toBe('string')
  })
})

describe('one element-to-source table for learn mode', () => {
  const root = html([
    '<h1>Big title</h1><h3> Small </h3>',
    '<p>some <strong>bold</strong>, <em>it</em>, <del>gone</del> and <code>x()</code> <a href="https://e.x/">here</a> <img src="p.png" alt="pic"></p>',
    '<blockquote><p>quoted\nmore</p></blockquote><hr>',
    '<pre data-lang="js"><code>let a = 1</code></pre>',
    '<table><tr><th>a</th></tr><tr><td>b</td></tr></table>',
    '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked> done</li></ul>',
    '<ul><li>bullet</li></ul><ol><li>first</li></ol>',
  ].join(''))
  const q = (s) => root.querySelector(s)

  it('shows the desktop the Markdown that made each element, as before', () => {
    expect(markdownSourceOf(q('h1'))).toBe('# Big title')
    expect(markdownSourceOf(q('h3'))).toBe('### Small')
    expect(markdownSourceOf(q('strong'))).toBe('**bold**')
    expect(markdownSourceOf(q('em'))).toBe('*it*')
    expect(markdownSourceOf(q('del'))).toBe('~~gone~~')
    expect(markdownSourceOf(q('p > code'))).toBe('`x()`')
    expect(markdownSourceOf(q('a'))).toBe('[here](https://e.x/)')
    expect(markdownSourceOf(q('img'))).toBe('![pic](p.png)')
    expect(markdownSourceOf(q('blockquote'))).toBe('> quoted')
    expect(markdownSourceOf(q('hr'))).toBe('---')
    expect(markdownSourceOf(q('pre'))).toBe('```js\nlet a = 1\n```')
    expect(markdownSourceOf(q('table'))).toBe('| Col | Col |\n| --- | --- |')
    expect(markdownSourceOf(q('li.task-list-item'))).toBe('- [x] done')
    expect(markdownSourceOf(q('ul:not(.contains-task-list)'))).toBe('- item\n- item')
    expect(markdownSourceOf(q('ol'))).toBe('1. item\n2. item')
    // Elements the desktop never annotated stay unannotated.
    expect(markdownSourceOf(q('pre code'))).toBeNull()
    expect(markdownSourceOf(q('td'))).toBeNull()
    expect(markdownSourceOf(q('p'))).toBeNull()
  })

  it('gives the phone the same names and syntax as before, from the same table', () => {
    expect(learnTarget(q('h1'), root)).toEqual({ name: 'Heading 1', syntax: '# Heading' })
    expect(learnTarget(q('strong'), root)).toEqual({ name: 'Bold', syntax: '**text**' })
    expect(learnTarget(q('del'), root)).toEqual({ name: 'Strikethrough', syntax: '~~text~~' })
    expect(learnTarget(q('pre code'), root)).toEqual({ name: 'Code block', syntax: '```\ncode\n```' })
    expect(learnTarget(q('p > code'), root)).toEqual({ name: 'Inline code', syntax: '`code`' })
    expect(learnTarget(q('blockquote p'), root)).toEqual({ name: 'Quote', syntax: '> quote' })
    expect(learnTarget(q('td'), root)).toEqual({ name: 'Table', syntax: '| a | b |\n| --- | --- |' })
    expect(learnTarget(q('li.task-list-item'), root)).toEqual({ name: 'Task', syntax: '- [ ] task' })
    expect(learnTarget(q('ol li'), root)).toEqual({ name: 'Numbered list item', syntax: '1. item' })
    expect(learnTarget(q('ul:not(.contains-task-list) li'), root)).toEqual({ name: 'List item', syntax: '- item' })
    expect(learnTarget(q('a'), root)).toEqual({ name: 'Link', syntax: '[text](url)' })
    expect(learnTarget(q('img'), root)).toEqual({ name: 'Image', syntax: '![alt](url)' })
    expect(learnTarget(q('hr'), root)).toEqual({ name: 'Divider', syntax: '---' })
    expect(learnTarget(q('p'), root)).toBeNull()
  })

  it('every table row has a phone name and syntax', () => {
    for (const r of LEARN_ELEMENTS) { expect(r.name).toBeTruthy(); expect(r.syntax).toBeTruthy() }
  })
})
