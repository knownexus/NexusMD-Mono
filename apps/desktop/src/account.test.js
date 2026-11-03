import { describe, it, expect, beforeEach, vi } from 'vitest'
import { importContainerKey, generateContainerKey, exportContainerKey } from '@nexusmd/core'
const clear = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@nexusmd/core', async (orig) => ({ ...(await orig()), clearAccountLocalData: clear }))

import { account } from './account.js'

describe('desktop account wiring', () => {
  beforeEach(() => localStorage.clear())

  it('exposes the shape AccountGate expects', () => {
    expect(account.platform).toBe('windows')
    expect(typeof account.createSync).toBe('function')
    expect(account.optOutKey).toBeTruthy()
    expect(typeof account.sessionStore.load).toBe('function')
    expect(typeof account.sessionStore.save).toBe('function')
  })

  it('deviceNameDefault returns a non-empty string', () => {
    expect(typeof account.deviceNameDefault()).toBe('string')
    expect(account.deviceNameDefault().length).toBeGreaterThan(0)
  })

  it('deviceStore persists the id in localStorage', () => {
    expect(account.deviceStore.get()).toBeNull()
    account.deviceStore.set('dev1')
    expect(account.deviceStore.get()).toBe('dev1')
    expect(localStorage.getItem('nexusmd.account.deviceId')).toBe('dev1')
  })

  it('binds the install to a user key and clearLocal delegates to core', async () => {
    expect(account.boundUserKey).toBe('nexusmd.account.userId')
    await account.clearLocal()
    const arg = clear.mock.calls[0][0]
    expect(arg.storage).toBe(localStorage)
    expect(arg.metaKey).toBe('nexusmd.account.meta')
    expect(arg.registry.secPrefix).toBe('nexusmd.sec.')
    expect(arg.secure).toBeTruthy()
  })

  it('deviceStore.set(null) removes the id instead of storing "null"', () => {
    account.deviceStore.set('dev1')
    account.deviceStore.set(null)
    expect(localStorage.getItem('nexusmd.account.deviceId')).toBeNull()
    expect(account.deviceStore.get()).toBeNull()
  })

  // registry v2: profile content (planner weeks) syncs; global keys outside a profile do not
  it('createSync snapshots connection settings and profile planner weeks but not global keys', async () => {
    localStorage.setItem('nexusmd.p.abc.ado.org', 'contoso')
    localStorage.setItem('nexusmd.p.abc.planner.week.2026-W01', '{"x":1}')
    localStorage.setItem('nexusmd.planner.week.2026-W02', '{"y":1}')
    const ck = await importContainerKey(await exportContainerKey(await generateContainerKey()))
    const sync = account.createSync(ck, 'dev1')
    const snap = await sync.snapshot()
    const entries = [...snap.entries()]
    expect(entries.some(([, e]) => e.storageKey === 'nexusmd.p.abc.ado.org' && e.value === 'contoso')).toBe(true)
    expect(entries.some(([, e]) => e.storageKey === 'nexusmd.p.abc.planner.week.2026-W01')).toBe(true)
    expect(entries.some(([, e]) => e.storageKey === 'nexusmd.planner.week.2026-W02')).toBe(false)
  })
})
