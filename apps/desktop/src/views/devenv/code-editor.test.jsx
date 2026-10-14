import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
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
})
