import { describe, it, expect } from 'vitest'
import { Icon } from '../src/index.js'

const NEW_ICONS = ['undo', 'redo', 'expand', 'collapse', 'upload', 'copy', 'download', 'wand']

describe('Icon — json-editor icon additions', () => {
  it.each(NEW_ICONS)('renders a non-null element for "%s"', (name) => {
    expect(Icon({ name })).not.toBeNull()
  })

  it('still returns null for an unknown icon name', () => {
    expect(Icon({ name: 'does-not-exist' })).toBeNull()
  })
})
