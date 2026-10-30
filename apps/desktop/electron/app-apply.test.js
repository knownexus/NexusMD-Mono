// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { pendingUpdates, applyAppUpdates } from './app-apply.cjs'

const app = (id, version, label = id) => ({ id, version, installedVersion: '1.0.0', manifest: { id, label }, mainFile: null })

describe('pendingUpdates', () => {
  it('lists the apps whose newest usable version is newer than the one running', () => {
    const running = [app('devenv', '1.0.1', 'Dev Environment'), app('git', '1.0.1')]
    const resolved = [app('devenv', '1.0.2', 'Dev Environment'), app('git', '1.0.1')]
    expect(pendingUpdates(running, resolved)).toEqual([{ id: 'devenv', label: 'Dev Environment', from: '1.0.1', to: '1.0.2' }])
  })
  it('leaves out apps switched off in Settings', () => {
    expect(pendingUpdates([app('git', '1.0.1')], [app('git', '1.0.2')], ['git'])).toEqual([])
  })
})

describe('applyAppUpdates', () => {
  const log = { info: vi.fn(), error: vi.fn() }
  const setup = (busy = { running: false, windows: 0 }) => {
    const running = [app('devenv', '1.0.1', 'Dev Environment'), app('git', '1.0.1')]
    const table = {}
    const started = { busy: vi.fn(() => busy), restart: vi.fn(async () => ({ ok: true })) }
    const reload = vi.fn()
    const options = {
      running, table, started, reload, log,
      resolve: () => [app('devenv', '1.0.2', 'Dev Environment'), app('git', '1.0.1')],
      toModule: a => ({ version: a.version }),
    }
    return { running, table, started, reload, options }
  }

  it('restarts each updated app on its new version, then reloads the window', async () => {
    const { running, table, started, reload, options } = setup()
    const result = await applyAppUpdates(options)
    expect(started.restart).toHaveBeenCalledWith('devenv', { version: '1.0.2' })
    expect(result).toEqual({ applied: [{ id: 'devenv', label: 'Dev Environment', from: '1.0.1', to: '1.0.2' }], busy: [], failed: [] })
    expect(running.find(a => a.id === 'devenv').version).toBe('1.0.2')
    expect(table.devenv).toEqual({ version: '1.0.2' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('stops to ask when an updated app is busy, and goes ahead when forced', async () => {
    const { started, reload, options } = setup({ running: true, windows: 0 })
    const result = await applyAppUpdates(options)
    expect(result.busy).toEqual([{ id: 'devenv', label: 'Dev Environment', running: true, windows: 0 }])
    expect(result.applied).toEqual([])
    expect(started.restart).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect((await applyAppUpdates({ ...options, force: true })).applied).toHaveLength(1)
  })

  it('keeps an app on its old version when the new one fails to start', async () => {
    const { running, started, reload, options } = setup()
    started.restart.mockResolvedValueOnce({ ok: false, error: 'boom' })
    const result = await applyAppUpdates(options)
    expect(result.failed).toEqual([{ id: 'devenv', label: 'Dev Environment', from: '1.0.1', to: '1.0.2', error: 'boom' }])
    expect(running.find(a => a.id === 'devenv').version).toBe('1.0.1')
    expect(reload).not.toHaveBeenCalled()
  })

  it('does nothing when nothing is waiting', async () => {
    const { started, reload, options } = setup()
    const result = await applyAppUpdates({ ...options, resolve: () => options.running.map(a => ({ ...a })) })
    expect(result).toEqual({ applied: [], busy: [], failed: [] })
    expect(started.restart).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
