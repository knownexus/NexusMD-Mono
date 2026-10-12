import { describe, it, expect } from 'vitest'
import { normaliseStatus } from './status.js'

const full = {
  type: 'result', kind: 'status', at: '2026-10-12T10:00:00Z',
  docker: { ok: true, error: null },
  backend: [{ key: 'orders', label: 'Orders API', port: 5101, state: 'running' }, { key: 'billing', label: 'Billing API', port: 5102, state: 'weird' }],
  infra: [{ service: 'storage', state: 'running' }],
  database: { state: 'running', ui: 'missing', baseline: 'b1' },
  test: { tracer: 'stopped', apis: [{ key: 'orders', label: 'Orders API', port: 5201, state: 'stopped' }] },
  android: { emulator: { running: true, serial: 'emulator-5554', avd: 'devenv' }, proxy: 'running' },
  ios: { host: 'mac.local', error: null },
}

describe('normaliseStatus', () => {
  it('keeps a full status and clamps unknown states to missing', () => {
    const s = normaliseStatus(full)
    expect(s.backend.map(b => b.state)).toEqual(['running', 'missing'])
    expect(s.database).toEqual({ state: 'running', ui: 'missing', baseline: 'b1' })
    expect(s.android.emulator.serial).toBe('emulator-5554')
    expect(s.ios.host).toBe('mac.local')
  })
  it('fills safe defaults for missing sections', () => {
    const s = normaliseStatus({ kind: 'status', docker: { ok: false, error: 'Docker is down' } })
    expect(s.docker).toEqual({ ok: false, error: 'Docker is down' })
    expect(s.backend).toEqual([])
    expect(s.test).toEqual({ tracer: 'missing', apis: [] })
    expect(s.android).toEqual({ emulator: null, proxy: 'missing' })
    expect(s.ios).toEqual({ host: null, error: null })
  })
  it('rejects non-status results', () => {
    expect(() => normaliseStatus({ kind: 'summary' })).toThrow(/Not a devenv status/)
  })
})
