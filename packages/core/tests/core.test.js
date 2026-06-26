import { describe, it, expect, beforeEach } from 'vitest'

// Import directly from source files to test in isolation
import { registerModule, getRegistry, clearRegistry } from '../src/features/module-registry.js'
import { core, initCore } from '../src/core.js'
import { createNoOpAdapters } from '../src/adapters/defaults.js'

function makeModule(id, defaultEnabled = false) {
  return {
    id,
    name: `Module ${id}`,
    requiredAdapters: [],
    defaultEnabled,
    init: () => {},
    load: async () => {},
    dispose: () => {},
  }
}

describe('module-registry', () => {
  beforeEach(() => clearRegistry())

  it('starts empty', () => {
    expect(getRegistry()).toEqual([])
  })

  it('buffers a registered module', () => {
    const mod = makeModule('ado')
    registerModule(mod)
    expect(getRegistry()).toHaveLength(1)
    expect(getRegistry()[0].id).toBe('ado')
  })

  it('buffers multiple modules in registration order', () => {
    registerModule(makeModule('ado'))
    registerModule(makeModule('planner'))
    registerModule(makeModule('github'))
    expect(getRegistry().map(m => m.id)).toEqual(['ado', 'planner', 'github'])
  })

  it('does not deduplicate by id — registering twice buffers twice', () => {
    registerModule(makeModule('ado'))
    registerModule(makeModule('ado'))
    expect(getRegistry()).toHaveLength(2)
  })
})

describe('initCore', () => {
  beforeEach(() => clearRegistry())

  it('resolves without throwing when given no-op adapters', async () => {
    await expect(initCore(createNoOpAdapters())).resolves.toBeUndefined()
  })

  it('resolves without throwing when called twice (idempotent for stubs)', async () => {
    await initCore(createNoOpAdapters())
    await expect(initCore(createNoOpAdapters())).resolves.toBeUndefined()
  })
})

describe('core.isEnabled', () => {
  beforeEach(() => clearRegistry())

  it('returns false for a module id that was never registered', async () => {
    await initCore(createNoOpAdapters())
    expect(core.isEnabled('nonexistent')).toBe(false)
  })

  it('returns false for a registered module whose defaultEnabled is false', async () => {
    registerModule(makeModule('ado', false))
    await initCore(createNoOpAdapters())
    expect(core.isEnabled('ado')).toBe(false)
  })

  it('returns true for a registered module whose defaultEnabled is true', async () => {
    registerModule(makeModule('planner', true))
    await initCore(createNoOpAdapters())
    expect(core.isEnabled('planner')).toBe(true)
  })
})

describe('core.getEnabledModules', () => {
  beforeEach(() => clearRegistry())

  it('returns empty array when no modules are registered', async () => {
    await initCore(createNoOpAdapters())
    expect(core.getEnabledModules()).toEqual([])
  })

  it('returns only the ids of defaultEnabled modules', async () => {
    registerModule(makeModule('ado', false))
    registerModule(makeModule('planner', true))
    registerModule(makeModule('triage', true))
    await initCore(createNoOpAdapters())
    expect(core.getEnabledModules()).toEqual(['planner', 'triage'])
  })
})

describe('core.on / core.off', () => {
  it('fires registered listeners on emit', () => {
    const events = []
    const handler = (payload) => events.push(payload)
    core.on('network:online', handler)
    core._emit('network:online', { src: 'test' })
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ src: 'test' })
    core.off('network:online', handler)
  })

  it('does not fire a listener after off() is called', () => {
    let count = 0
    const handler = () => count++
    core.on('data:updated', handler)
    core._emit('data:updated', {})
    core.off('data:updated', handler)
    core._emit('data:updated', {})
    expect(count).toBe(1)
  })

  it('calling off() for an unregistered event does not throw', () => {
    expect(() => core.off('unknown:event', () => {})).not.toThrow()
  })
})
