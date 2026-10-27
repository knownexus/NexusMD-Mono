// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import manifest from '../../app.manifest.json'
import { validateManifest } from '@nexusmd/shell-sdk'

const require = createRequire(import.meta.url)
const { register } = require('./index.cjs')

// The preload builds window.electronAPI.database from the manifest, so a channel that is listed
// there but never handled would fail only when someone clicks the button.
function registerWithFakes() {
  const handled = new Set()
  const sent = []
  const handle = register({
    ipcMain: { handle: (channel) => handled.add(channel), on: vi.fn() },
    send: (channel, msg) => sent.push([channel, msg]),
  })
  return { handled, sent, handle }
}

const methods = () => Object.values(manifest.ipc.preload).flatMap(ns => Object.values(ns))

describe('database app manifest', () => {
  it('is a valid app manifest', () => {
    expect(validateManifest(manifest)).toEqual([])
    expect(manifest.id).toBe('database')
  })

  it('has an invoke handler for every invoke channel it exposes', () => {
    const { handled } = registerWithFakes()
    const missing = methods().filter(m => m.invoke).map(m => m.invoke).filter(c => !handled.has(c))
    expect(missing).toEqual([])
  })

  it('exposes every database:* handler the main process registers', () => {
    const { handled } = registerWithFakes()
    const exposed = new Set(methods().map(m => m.invoke).filter(Boolean))
    const unexposed = [...handled].filter(c => c.startsWith('database:') && !exposed.has(c))
    expect(unexposed).toEqual([])
  })

  it('closes its connections on quit', () => {
    expect(typeof registerWithFakes().handle.dispose).toBe('function')
  })
})
