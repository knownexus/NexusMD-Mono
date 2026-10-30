import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createCapabilities } from '@nexusmd/shell-sdk'

vi.mock('@nexusmd/editor-kit/code-editor.jsx', () => ({ languageForPath: () => 'plaintext', CodeEditor: () => null }))

import editor from './index.js'
import { editorStore } from './editor-singleton.js'

const hostWith = () => ({ capabilities: createCapabilities(), navigate: vi.fn() })

beforeEach(() => {
  vi.spyOn(editorStore, 'openPath').mockResolvedValue(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  delete window.electronAPI
  window.location.hash = ''
})

describe('editor.openPath', () => {
  it('is offered to other apps and opens the path, then shows the Editor', async () => {
    const host = hostWith()
    editor.activate(host)
    expect(host.capabilities.has('editor.openPath')).toBe(true)
    expect(await host.capabilities.call('editor.openPath', 'C:\\repos\\a.js', 12)).toBe(true)
    expect(editorStore.openPath).toHaveBeenCalledWith('C:\\repos\\a.js', { line: 12 })
    expect(host.navigate).toHaveBeenCalledWith('editor')
  })
  it('leaves the shell where it is when the path could not be opened', async () => {
    editorStore.openPath.mockResolvedValue(false)
    const host = hostWith()
    editor.activate(host)
    expect(await host.capabilities.call('editor.openPath', '/missing')).toBe(false)
    expect(host.navigate).not.toHaveBeenCalled()
  })
  it('works without a line', async () => {
    const host = hostWith()
    editor.activate(host)
    await host.capabilities.call('editor.openPath', '/a')
    expect(editorStore.openPath).toHaveBeenCalledWith('/a', { line: null })
  })
})

describe('editor.openText', () => {
  it('opens the text read-only and shows the Editor', async () => {
    const openText = vi.spyOn(editorStore, 'openText').mockImplementation(() => {})
    const host = hostWith()
    editor.activate(host)
    const spec = { id: 'github:a/b@main:x', name: 'x', text: 't', origin: 'a/b' }
    expect(await host.capabilities.call('editor.openText', spec)).toBe(true)
    expect(openText).toHaveBeenCalledWith(spec)
    expect(host.navigate).toHaveBeenCalledWith('editor')
  })
})

describe('files the app is opened with', () => {
  const bridge = (pending = []) => {
    const api = { takePending: vi.fn(async () => pending), onOpenRequest: vi.fn() }
    window.electronAPI = { editor: api }
    return api
  }

  it('opens what was waiting at startup and shows the Editor', async () => {
    const api = bridge(['/a.txt', '/b.txt'])
    const host = hostWith()
    editor.activate(host)
    await vi.waitFor(() => expect(host.navigate).toHaveBeenCalledWith('editor'))
    expect(editorStore.openPath.mock.calls.map(c => c[0])).toEqual(['/a.txt', '/b.txt'])
    expect(api.takePending).toHaveBeenCalledTimes(1)
  })
  it('does not switch to the Editor when nothing was waiting', async () => {
    bridge([])
    const host = hostWith()
    editor.activate(host)
    await Promise.resolve(); await Promise.resolve()
    expect(host.navigate).not.toHaveBeenCalled()
  })
  it('opens files from a later launch as they arrive', () => {
    const api = bridge([])
    const host = hostWith()
    editor.activate(host)
    const [listener] = api.onOpenRequest.mock.calls[0]
    listener(['/later.txt'])
    expect(editorStore.openPath).toHaveBeenCalledWith('/later.txt')
    expect(host.navigate).toHaveBeenCalledWith('editor')
  })
  it('stays out of it in a pop-out window, which is not the app', () => {
    const api = bridge(['/a.txt'])
    window.location.hash = '#popout=%7B%7D'
    const host = hostWith()
    editor.activate(host)
    expect(api.takePending).not.toHaveBeenCalled()
    expect(api.onOpenRequest).not.toHaveBeenCalled()
  })
  it('still offers the capability where there is no bridge (tests, browser)', () => {
    const host = hostWith()
    expect(() => editor.activate(host)).not.toThrow()
    expect(host.capabilities.has('editor.openPath')).toBe(true)
  })
})
