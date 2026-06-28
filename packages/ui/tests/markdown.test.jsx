import { describe, it, expect } from 'vitest'
import { MarkdownViewer, displayName } from '../src/index.js'

// MarkdownViewer is deeply browser-coupled (localStorage doc store, on-demand CDN
// highlight.js, contentEditable) so a jsdom mount isn't meaningful; the 3-platform
// builds + barrel import already prove it compiles/loads. We guard the exported
// surface and the pure displayName helper here.
describe('MarkdownViewer (shared web + app)', () => {
  it('is exported as a component', () => {
    expect(typeof MarkdownViewer).toBe('function')
  })

  it('displayName prefers an explicit name, falling back to autoName', () => {
    expect(displayName({ name: 'Spec', autoName: 'Untitled' })).toBe('Spec')
    expect(displayName({ name: undefined, autoName: 'Untitled' })).toBe('Untitled')
    expect(displayName({ name: null, autoName: 'Auto' })).toBe('Auto')
  })
})
