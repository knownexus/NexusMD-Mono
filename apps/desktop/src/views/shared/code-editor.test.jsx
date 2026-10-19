import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { EditorView } from 'codemirror'
import { undo } from '@codemirror/commands'
import { CodeEditor, languageForPath } from './code-editor.jsx'

afterEach(cleanup)

describe('CodeEditor', () => {
  it('shows the value in a CodeMirror editor with an accessible label', () => {
    const { container } = render(<CodeEditor value={'{\n  "a": 1\n}\n'} language="json" onChange={() => {}} ariaLabel="Edit environment.json" />)
    const content = container.querySelector('.cm-content')
    expect(content).toBeTruthy()
    expect(content.getAttribute('aria-label')).toBe('Edit environment.json')
    expect(content.textContent).toContain('"a": 1')
  })
  it('replaces the document when the value changes from outside', () => {
    const { container, rerender } = render(<CodeEditor value="one" language="text" onChange={() => {}} ariaLabel="x" />)
    rerender(<CodeEditor value="two" language="text" onChange={() => {}} ariaLabel="x" />)
    expect(container.querySelector('.cm-content').textContent).toBe('two')
  })
  it('accepts every profile language', () => {
    for (const language of ['json', 'yaml', 'powershell', 'sql', 'markdown', 'text']) {
      const { container, unmount } = render(<CodeEditor value="x" language={language} onChange={() => {}} ariaLabel={language} />)
      expect(container.querySelector('.cm-editor')).toBeTruthy()
      unmount()
    }
  })
  const viewOf = container => EditorView.findFromDOM(container.querySelector('.cm-editor'))
  it('reports user edits through onChange', () => {
    const onChange = vi.fn()
    const { container } = render(<CodeEditor value="a" language="text" onChange={onChange} ariaLabel="x" />)
    viewOf(container).dispatch({ changes: { from: 0, insert: 'x' } })
    expect(onChange).toHaveBeenCalledWith('xa')
  })
  it('does not report external value changes, and undo cannot bring them back', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<CodeEditor value="one" language="text" onChange={onChange} ariaLabel="x" />)
    rerender(<CodeEditor value="two" language="text" onChange={onChange} ariaLabel="x" />)
    expect(onChange).not.toHaveBeenCalled()
    const view = viewOf(container)
    undo(view)
    expect(view.state.doc.toString()).toBe('two')
    expect(onChange).not.toHaveBeenCalled()
  })
  it('treats CRLF values as their normalised form and does not re-dispatch for them', () => {
    const onChange = vi.fn()
    const crlf = 'a\r\nb'
    const { container, rerender } = render(<CodeEditor value={crlf} language="text" onChange={onChange} ariaLabel="x" />)
    const view = viewOf(container)
    expect(view.state.doc.toString()).toBe('a\nb')
    view.dispatch({ selection: { anchor: 3 } })
    rerender(<CodeEditor value={crlf} language="text" onChange={onChange} ariaLabel="x" />)
    expect(view.state.selection.main.anchor).toBe(3)
    expect(onChange).not.toHaveBeenCalled()
  })
  it('languageForPath maps each extension', () => {
    const table = {
      'a.js': 'javascript', 'a.mjs': 'javascript', 'a.cjs': 'javascript', 'a.jsx': 'javascript',
      'a.ts': 'typescript', 'a.tsx': 'typescript', 'a.mts': 'typescript', 'a.cts': 'typescript',
      'a.css': 'css', 'a.scss': 'css', 'a.less': 'css', 'a.html': 'html', 'a.htm': 'html',
      'a.cs': 'csharp', 'a.csx': 'csharp', 'a.json': 'json', 'a.yml': 'yaml', 'a.yaml': 'yaml',
      'a.sql': 'sql', 'a.md': 'markdown', 'a.markdown': 'markdown',
      'a.ps1': 'powershell', 'a.psm1': 'powershell', 'a.psd1': 'powershell',
      'DIR/A.TSX': 'typescript', README: null, 'a.txt': null,
    }
    for (const [path, lang] of Object.entries(table)) expect(languageForPath(path), path).toBe(lang)
  })
  it('accepts the new languages', () => {
    for (const language of ['javascript', 'typescript', 'css', 'html', 'csharp']) {
      const { container, unmount } = render(<CodeEditor value="x" language={language} onChange={() => {}} ariaLabel={language} />)
      expect(container.querySelector('.cm-editor')).toBeTruthy()
      unmount()
    }
  })
  it('jumps to the given line', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n')
    const { container } = render(<CodeEditor value={text} language="text" onChange={() => {}} ariaLabel="x" line={30} />)
    const view = viewOf(container)
    expect(view.state.selection.main.head).toBe(view.state.doc.line(30).from)
  })
  it('readOnly blocks typing', () => {
    const { container } = render(<CodeEditor value="a" language="text" onChange={() => {}} ariaLabel="x" readOnly />)
    expect(viewOf(container).state.readOnly).toBe(true)
  })
})
