import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup, act } from '@testing-library/react'
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
  it('is at least 240px tall by default, and a screen with less room can ask for a smaller minimum', () => {
    const hostOf = (container) => container.querySelector('.cm-editor').parentElement
    const { container, unmount } = render(<CodeEditor value="x" language="text" onChange={() => {}} ariaLabel="x" />)
    expect(hostOf(container).style.minHeight).toBe('240px')
    unmount()
    const small = render(<CodeEditor value="x" language="text" onChange={() => {}} ariaLabel="x" minHeight={96} />)
    expect(hostOf(small.container).style.minHeight).toBe('96px')
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
  const fifty = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n')
  const noop = () => {}
  it('re-jumps when a new { line } object asks for the same line', () => {
    const { container, rerender } = render(<CodeEditor value={fifty} language="text" onChange={noop} ariaLabel="x" line={{ line: 30 }} />)
    const view = viewOf(container)
    view.dispatch({ selection: { anchor: 0 } })
    rerender(<CodeEditor value={fifty} language="text" onChange={noop} ariaLabel="x" line={{ line: 30 }} />)
    expect(view.state.selection.main.head).toBe(view.state.doc.line(30).from)
  })
  it('jumps again after the text is replaced', () => {
    const { container, rerender } = render(<CodeEditor value={fifty} language="text" onChange={noop} ariaLabel="x" line={30} />)
    const view = viewOf(container)
    const other = fifty.replace('line 1\n', 'one\n')
    rerender(<CodeEditor value={other} language="text" onChange={noop} ariaLabel="x" line={30} />)
    view.dispatch({ selection: { anchor: 0 } })
    rerender(<CodeEditor value={other + ' '} language="text" onChange={noop} ariaLabel="x" line={30} />)
    rerender(<CodeEditor value={fifty} language="text" onChange={noop} ariaLabel="x" line={30} />)
    expect(view.state.selection.main.head).toBe(view.state.doc.line(30).from)
  })
  it('ignores a non-finite line', () => {
    const { container } = render(<CodeEditor value={fifty} language="text" onChange={noop} ariaLabel="x" line={NaN} />)
    expect(viewOf(container).state.selection.main.head).toBe(0)
  })
  it('typing does not re-jump', () => {
    const Host = () => {
      const [v, setV] = React.useState(fifty)
      return <CodeEditor value={v} language="text" onChange={setV} ariaLabel="x" line={30} />
    }
    const { container } = render(<Host />)
    const view = viewOf(container)
    view.dispatch({ selection: { anchor: 0 } })
    act(() => view.dispatch({ changes: { from: 5, insert: 'x' }, selection: { anchor: 6 } }))
    expect(view.state.selection.main.head).toBe(6)
  })
})

describe('CodeEditor apiRef.replaceText', () => {
  const viewOf = container => EditorView.findFromDOM(container.querySelector('.cm-editor'))

  it('reports the new text through onChange', () => {
    const onChange = vi.fn()
    const apiRef = React.createRef()
    const { container } = render(<CodeEditor value="a" language="text" onChange={onChange} ariaLabel="x" apiRef={apiRef} />)
    act(() => apiRef.current.replaceText('b'))
    expect(viewOf(container).state.doc.toString()).toBe('b')
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('can be undone, in one step, and undo reports the original text', () => {
    const onChange = vi.fn()
    const apiRef = React.createRef()
    const { container } = render(<CodeEditor value="original" language="text" onChange={onChange} ariaLabel="x" apiRef={apiRef} />)
    const view = viewOf(container)
    view.dispatch({ changes: { from: 8, insert: '!' } }) // typing just before, so the two could be merged into one undo step
    act(() => apiRef.current.replaceText('tidy'))
    expect(view.state.doc.toString()).toBe('tidy')
    undo(view)
    expect(view.state.doc.toString()).toBe('original!')
    expect(onChange).toHaveBeenLastCalledWith('original!')
  })

  it('keeps the cursor, clamped to the new length', () => {
    const apiRef = React.createRef()
    const { container } = render(<CodeEditor value="a long line of text" language="text" onChange={() => {}} ariaLabel="x" apiRef={apiRef} />)
    const view = viewOf(container)
    view.dispatch({ selection: { anchor: 15 } })
    act(() => apiRef.current.replaceText('short'))
    expect(view.state.selection.main.head).toBe(5)
    act(() => apiRef.current.replaceText('a much longer replacement'))
    expect(view.state.selection.main.head).toBe(5)
  })

  it('does nothing when the text is already the same', () => {
    const onChange = vi.fn()
    const apiRef = React.createRef()
    render(<CodeEditor value="same" language="text" onChange={onChange} ariaLabel="x" apiRef={apiRef} />)
    act(() => apiRef.current.replaceText('same'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is cleared on unmount', () => {
    const apiRef = React.createRef()
    const { unmount } = render(<CodeEditor value="a" language="text" onChange={() => {}} ariaLabel="x" apiRef={apiRef} />)
    expect(apiRef.current).toBeTruthy()
    unmount()
    expect(apiRef.current).toBeNull()
  })

  it('leaves a props-driven replacement out of undo history', () => {
    const apiRef = React.createRef()
    const { container, rerender } = render(<CodeEditor value="one" language="text" onChange={() => {}} ariaLabel="x" apiRef={apiRef} />)
    rerender(<CodeEditor value="two" language="text" onChange={() => {}} ariaLabel="x" apiRef={apiRef} />)
    const view = viewOf(container)
    undo(view)
    expect(view.state.doc.toString()).toBe('two')
  })
})
