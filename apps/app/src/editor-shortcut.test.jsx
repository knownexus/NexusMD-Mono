import React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@capacitor/core', async orig => ({ ...(await orig()), CapacitorHttp: undefined }))

import { EditorScreen } from './editor-screen.jsx'
import { editorWorkspace } from './adapters/editor-workspace.js'

const phone = (matches) => {
  window.matchMedia = vi.fn(() => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }))
}
const write = (p, text = 'x') => editorWorkspace.write(p, text, { overwrite: true })

beforeEach(async () => {
  localStorage.clear()
  phone(true)
  await write('/editor/top.md')
  await write('/editor/notes/a.md')
  await write('/editor/notes/deep/b.md')
})
afterEach(() => { cleanup(); window.NexusMDNav = null })

describe('the phone Editor opened from a Home shortcut to a folder', () => {
  it('starts in that folder, and takes the target once', async () => {
    window.NexusMDNav = { view: 'editor', target: { target: 'editor', kind: 'folder', path: '/editor/notes', platform: 'mobile' } }
    render(<EditorScreen />)
    expect(await screen.findByText('a.md')).toBeTruthy()
    expect(screen.getByText('deep')).toBeTruthy()
    expect(screen.queryByText('top.md')).toBeNull()
    expect(screen.getByText('Up one folder')).toBeTruthy()
    await waitFor(() => expect(window.NexusMDNav.target).toBeNull())
  })

  it('starts at the workspace with no shortcut', async () => {
    render(<EditorScreen />)
    expect(await screen.findByText('top.md')).toBeTruthy()
    expect(screen.queryByText('Up one folder')).toBeNull()
  })

  it('ignores a folder outside the workspace', async () => {
    window.NexusMDNav = { view: 'editor', target: { target: 'editor', kind: 'folder', path: '/etc', platform: 'mobile' } }
    render(<EditorScreen />)
    expect(await screen.findByText('top.md')).toBeTruthy()
  })

  it('a stale target does not send a later visit into the folder', async () => {
    window.NexusMDNav = { view: 'editor', target: { target: 'editor', kind: 'folder', path: '/editor/notes', platform: 'mobile' } }
    const first = render(<EditorScreen />)
    await screen.findByText('a.md')
    first.unmount()
    render(<EditorScreen />)
    expect(await screen.findByText('top.md')).toBeTruthy()
  })
})

describe('the tablet Editor opened from a Home shortcut', () => {
  it('takes the target so it is not left waiting', async () => {
    phone(false)
    window.NexusMDNav = { view: 'editor', target: { target: 'editor', kind: 'file', path: '/editor/top.md', platform: 'mobile' } }
    render(<EditorScreen />)
    await waitFor(() => expect(window.NexusMDNav.target).toBeNull())
  })
})
