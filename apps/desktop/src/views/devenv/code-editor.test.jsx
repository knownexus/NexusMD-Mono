import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { EditorView } from 'codemirror'
import { undo } from '@codemirror/commands'
import { CodeEditor } from './code-editor.jsx'

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
})
