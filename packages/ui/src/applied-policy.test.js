import { describe, it, expect } from 'vitest'
import { appliedAction } from './applied-policy.js'

const live = (id) => /tweaks#|work\.screens\.off$|settings\.collapsed$/.test(id)
const ctx = { active: 'P1', isLiveSafe: live }
const item = (id, profileId = 'P1') => ({ id, profileId })
const info = (...items) => ({ applied: items.length, items, global: items.some(i => !i.profileId) })

describe('appliedAction: what to do when a pull changed local data', () => {
  it('reloads when the pull does not say what it wrote, as before', () => {
    expect(appliedAction({ applied: 2, items: null, global: true }, ctx)).toEqual({ type: 'reload' })
    expect(appliedAction({ applied: 2 }, ctx)).toEqual({ type: 'reload' })
    expect(appliedAction(undefined, ctx)).toEqual({ type: 'reload' })
    expect(appliedAction(info(), ctx)).toEqual({ type: 'reload' })
  })

  it('reloads when the profile in use is not known', () => {
    expect(appliedAction(info(item('nexusmd:p.P1.tweaks#navHidden')), { isLiveSafe: live })).toEqual({ type: 'reload' })
    expect(appliedAction(info(item('nexusmd:p.P1.tweaks#navHidden')), { active: null, isLiveSafe: live })).toEqual({ type: 'reload' })
  })

  it('does nothing when only profiles that are not in use changed', () => {
    expect(appliedAction(info(item('p.P2.ado.org', 'P2'), item('nexusmd:p.P3.md_documents#d1', 'P3')), ctx)).toEqual({ type: 'none' })
  })

  it('does nothing for another profile even when what changed is not live-safe', () => {
    expect(appliedAction(info(item('nexusmd:p.P2.md_documents#d1', 'P2')), ctx)).toEqual({ type: 'none' })
  })

  it('goes live for settings of the profile in use that the screens can read again, saying which', () => {
    expect(appliedAction(info(item('nexusmd:p.P1.tweaks#navHidden'), item('nexusmd:p.P1.tweaks#dashLayouts')), ctx))
      .toEqual({ type: 'live', collIds: ['tweaks'] })
    expect(appliedAction(info(item('nexusmd:p.P1.work.screens.off'), item('nexusmd:p.P1.tweaks#navHidden')), ctx))
      .toEqual({ type: 'live', collIds: ['work-screens', 'tweaks'] })
    expect(appliedAction(info(item('nexusmd:p.P1.nexusmd.settings.collapsed')), ctx))
      .toEqual({ type: 'live', collIds: ['settings-collapsed'] })
  })

  it('goes live for the profile in use even when other profiles changed in the same pull', () => {
    expect(appliedAction(info(item('nexusmd:p.P1.tweaks#navHidden'), item('p.P2.ado.org', 'P2')), ctx))
      .toEqual({ type: 'live', collIds: ['tweaks'] })
  })

  it('reloads when anything of the profile in use is not live-safe, even among live-safe changes', () => {
    expect(appliedAction(info(item('nexusmd:p.P1.tweaks#navHidden'), item('nexusmd:p.P1.md_documents#d1')), ctx)).toEqual({ type: 'reload' })
    expect(appliedAction(info(item('p.P1.ado.org')), ctx)).toEqual({ type: 'reload' })
  })

  it('reloads when something that belongs to no profile changed (the profiles list, this device’s prefs)', () => {
    expect(appliedAction(info(item('profiles', null)), ctx)).toEqual({ type: 'reload' })
    expect(appliedAction(info(item('nexusmd:p.P1.tweaks#navHidden'), item('device:prefs', null)), ctx)).toEqual({ type: 'reload' })
    expect(appliedAction(info(item('p.P2.ado.org', 'P2'), item('profiles', null)), ctx)).toEqual({ type: 'reload' })
  })

  it('reloads when nothing says what is safe', () => {
    expect(appliedAction(info(item('nexusmd:p.P1.tweaks#navHidden')), { active: 'P1' })).toEqual({ type: 'reload' })
  })

  it('ignores a malformed item rather than guess: it reloads', () => {
    expect(appliedAction({ applied: 1, items: [null], global: false }, ctx)).toEqual({ type: 'reload' })
    expect(appliedAction({ applied: 1, items: [{ id: 'x' }], global: false }, ctx)).toEqual({ type: 'reload' })
  })
})
