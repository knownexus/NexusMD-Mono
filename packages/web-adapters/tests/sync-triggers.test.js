import { describe, it, expect, vi } from 'vitest'
import { domDispatch, domSubscribeChange, domSubscribeForeground } from '../src/index.js'

describe('sync triggers', () => {
  it('domDispatch emits a document CustomEvent carrying the detail', () => {
    const seen = vi.fn()
    document.addEventListener('nexusmd:sync-applied', seen)
    domDispatch('nexusmd:sync-applied', { collId: 'notes' })
    document.removeEventListener('nexusmd:sync-applied', seen)
    expect(seen.mock.calls[0][0].detail).toEqual({ collId: 'notes' })
  })

  it('domSubscribeChange fires on planner/data changes until unsubscribed', () => {
    const cb = vi.fn()
    const off = domSubscribeChange(cb)
    document.dispatchEvent(new CustomEvent('nexusmd:planner-changed'))
    document.dispatchEvent(new CustomEvent('nexusmd:data-changed'))
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    document.dispatchEvent(new CustomEvent('nexusmd:data-changed'))
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('domSubscribeForeground fires on window focus until unsubscribed', () => {
    const cb = vi.fn()
    const off = domSubscribeForeground(cb)
    window.dispatchEvent(new Event('focus'))
    off()
    window.dispatchEvent(new Event('focus'))
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
