// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { register, runScript } from './api-client-script.cjs'

// Fake ipcMain that captures handlers by channel name
function fakeIpc() {
  const h = {}
  return { ipcMain: { handle: (c, fn) => { h[c] = fn } }, h }
}

function fakeLogger() {
  const noop = vi.fn()
  return { scope: () => ({ info: noop, error: noop }) }
}

describe('api-client-script ipc', () => {
  it('runs a script that mutates context and returns the resulting context', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, { logger: fakeLogger() })

    const result = await h['api-client:script:run'](null, 'context.vars.token = "abc"', { vars: {} })

    expect(result.error).toBeNull()
    expect(result.context).toEqual({ vars: { token: 'abc' } })
  })

  it('logs is always [] (console capture is not supported — see security comment in the .cjs)', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, { logger: fakeLogger() })

    // Node auto-injects a `console` into vm contexts regardless of what we pass
    // in, so this does not throw — it just isn't wired to capture anything.
    const result = await h['api-client:script:run'](null, 'console.log("hi")', {})

    expect(result.error).toBeNull()
    expect(result.logs).toEqual([])
  })

  it('blocks the Function/eval/.constructor-chain vm-escape (verified against this Node build to otherwise reach the live host process)', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, { logger: fakeLogger() })

    const attempts = [
      '(function(){}).constructor("return process")()',
      'Function("return process")()',
      'eval("process.pid")',
      'console.log.constructor("return process")()',
    ]
    for (const script of attempts) {
      const result = await h['api-client:script:run'](null, script, {})
      expect(result.error).toMatch(/code generation from strings disallowed/i)
    }
  })

  it('returns a structured error instead of throwing when the script errors', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, { logger: fakeLogger() })

    const result = await h['api-client:script:run'](null, 'throw new Error("boom")', {})

    expect(result.error).toBe('boom')
    expect(result.context).toBeNull()
  })

  it('does not leak a live reference to the input context (deep-clones it)', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, { logger: fakeLogger() })
    const input = { vars: { a: 1 } }

    await h['api-client:script:run'](null, 'context.vars.a = 999', input)

    expect(input.vars.a).toBe(1)
  })

  it('times out a runaway synchronous script rather than hanging the IPC call', async () => {
    const { ipcMain, h } = fakeIpc()
    register(ipcMain, { logger: fakeLogger(), timeoutMs: 50 })

    const result = await h['api-client:script:run'](null, 'while (true) {}', {})

    expect(result.error).toMatch(/timed out/i)
  }, 2000)

  it('runScript is directly reusable outside of IPC', () => {
    const result = runScript('context.x = 1', {})
    expect(result.context).toEqual({ x: 1 })
    expect(result.error).toBeNull()
  })
})
