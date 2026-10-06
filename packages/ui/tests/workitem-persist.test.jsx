import { it, expect, afterEach, vi } from 'vitest'
import { patchWorkItem } from '../src/views/view-workitems.jsx'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../src/toast.jsx', () => ({ toast }))

afterEach(() => vi.restoreAllMocks())

it('routes writes through workItemSource.saveField (one call per op, /fields/ stripped)', async () => {
  const saveField = vi.fn().mockResolvedValue(undefined)
  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)

  await patchWorkItem({ saveField }, 7, [
    ['/fields/System.State', 'Done'],
    ['/fields/System.AssignedTo', 'Alice'],
  ])

  expect(saveField).toHaveBeenNthCalledWith(1, 7, 'System.State', 'Done')
  expect(saveField).toHaveBeenNthCalledWith(2, 7, 'System.AssignedTo', 'Alice')
  expect(fetchSpy).not.toHaveBeenCalled()
})

it('coerces a null value (unassign) to an empty string for ADO', async () => {
  const saveField = vi.fn().mockResolvedValue(undefined)
  await patchWorkItem({ saveField }, 7, [['/fields/System.AssignedTo', null]])
  expect(saveField).toHaveBeenCalledWith(7, 'System.AssignedTo', '')
})

it('surfaces a save failure via toast instead of silently swallowing it', async () => {
  const saveField = vi.fn().mockRejectedValue(new Error('HTTP 403'))
  await patchWorkItem({ saveField }, 7, [['/fields/System.State', 'Done']])
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('403'), 'error')
})

it('falls back to the /api/workitems web endpoint when no workItemSource is injected', async () => {
  const fetchSpy = vi.fn(async () => ({ ok: true }))
  vi.stubGlobal('fetch', fetchSpy)
  await patchWorkItem(undefined, 7, [['/fields/System.State', 'Done']])
  expect(fetchSpy).toHaveBeenCalledWith('/api/workitems/7', expect.objectContaining({ method: 'PATCH' }))
})

it('returns true on success and false after a failure', async () => {
  expect(await patchWorkItem({ saveField: vi.fn().mockResolvedValue() }, 7, [['/fields/System.State', 'Done']])).toBe(true)
  expect(await patchWorkItem({ saveField: vi.fn().mockRejectedValue(new Error('nope')) }, 7, [['/fields/System.State', 'Done']])).toBe(false)
})
