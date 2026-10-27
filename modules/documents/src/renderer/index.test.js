import { describe, it, expect } from 'vitest'
import documents from './index.js'

describe('Documents app', () => {
  it('owns the markdown view', () => {
    expect(documents.id).toBe('documents')
    expect(typeof documents.views.markdown).toBe('function')
  })
})
