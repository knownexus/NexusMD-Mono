import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { PRActions } from './pr-actions.jsx'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../toast.jsx', () => ({ toast, ToastHost: () => null }))

afterEach(() => { cleanup(); toast.mockReset() })

const PR = { id: 1, status: 'active' }
const METHODS = [{ id: 'squash', label: 'Squash' }, { id: 'noFastForward', label: 'Merge commit' }]
function mk(over = {}) {
  return {
    approve: vi.fn(async () => ({ patch: { myVote: 10 }, warnings: [] })),
    waitForAuthor: vi.fn(async () => ({ patch: { myVote: -5 }, warnings: [] })),
    reject: vi.fn(async () => ({ patch: { status: 'abandoned' }, warnings: [] })),
    merge: vi.fn(async () => ({ patch: { status: 'merged' }, warnings: [] })),
    mergeOptions: vi.fn(async () => ({ methods: METHODS, rejectConfirm: 'Really reject?' })),
    ...over,
  }
}
const setup = (o = {}) => {
  const actions = o.actions || mk()
  const onChanged = vi.fn()
  const confirm = o.confirm || vi.fn(() => true)
  render(<PRActions pr={o.pr || PR} actions={actions} onChanged={onChanged} confirm={confirm} />)
  return { actions, onChanged, confirm }
}
const names = () => screen.queryAllByRole('button').map(b => b.textContent)

it('shows four buttons for active, three for draft, none otherwise', () => {
  setup()
  expect(names()).toEqual(['Approve', 'Wait for author', 'Reject', 'Merge'])
  cleanup()
  setup({ pr: { ...PR, status: 'draft' } })
  expect(names()).toEqual(['Approve', 'Wait for author', 'Reject'])
  cleanup()
  setup({ pr: { ...PR, status: 'merged' } })
  expect(names()).toEqual([])
  cleanup()
  setup({ pr: { ...PR, status: 'abandoned' } })
  expect(names()).toEqual([])
})

it('approve calls action, disables buttons while pending, ignores second click', async () => {
  let resolve
  const actions = mk({ approve: vi.fn(() => new Promise(r => { resolve = r })) })
  const { onChanged } = setup({ actions })
  fireEvent.click(screen.getByText('Approve'))
  await waitFor(() => screen.getAllByRole('button').forEach(b => expect(b.disabled).toBe(true)))
  fireEvent.click(screen.getByText('Approve'))
  expect(actions.approve).toHaveBeenCalledTimes(1)
  expect(actions.approve).toHaveBeenCalledWith(PR)
  resolve({ patch: { myVote: 10 }, warnings: [] })
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ myVote: 10 }))
  expect(toast).toHaveBeenCalledWith('Approved', 'success')
})

it('wait for author', async () => {
  const { actions, onChanged } = setup()
  fireEvent.click(screen.getByText('Wait for author'))
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ myVote: -5 }))
  expect(actions.waitForAuthor).toHaveBeenCalledWith(PR)
  expect(toast).toHaveBeenCalledWith('Marked as waiting for author', 'success')
})

it('reject honours confirm', async () => {
  const confirm = vi.fn(() => false)
  const { actions, onChanged } = setup({ confirm })
  fireEvent.click(screen.getByText('Reject'))
  await waitFor(() => expect(confirm).toHaveBeenCalledWith('Really reject?'))
  expect(actions.reject).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByText('Reject'))
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ status: 'abandoned' }))
  expect(actions.reject).toHaveBeenCalledWith(PR)
  expect(toast).toHaveBeenCalledWith('Pull request rejected', 'success')
})

it('merge dialog sends chosen options and closes', async () => {
  const { actions, onChanged } = setup()
  fireEvent.click(screen.getByText('Merge'))
  const dlg = await screen.findByRole('dialog', { name: 'Merge pull request' })
  await within(dlg).findByRole('option', { name: 'Squash' })
  expect(within(dlg).getByRole('option', { name: 'Merge commit' })).toBeTruthy()
  const cb = within(dlg).getByLabelText('Delete source branch')
  expect(cb.checked).toBe(true)
  fireEvent.change(within(dlg).getByLabelText('Merge type'), { target: { value: 'squash' } })
  fireEvent.click(cb)
  fireEvent.click(within(dlg).getByRole('button', { name: 'Merge' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ status: 'merged' }))
  expect(actions.merge).toHaveBeenCalledWith(PR, { method: 'squash', deleteBranch: false })
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('no merge methods disables dialog Merge', async () => {
  const actions = mk({ mergeOptions: vi.fn(async () => ({ methods: [], rejectConfirm: 'x' })) })
  setup({ actions })
  fireEvent.click(screen.getByText('Merge'))
  const dlg = await screen.findByRole('dialog')
  await within(dlg).findByText('This repository allows no merge methods')
  expect(within(dlg).getByRole('button', { name: 'Merge' }).disabled).toBe(true)
})

it('errors toast and leave PR unchanged', async () => {
  const actions = mk({ approve: vi.fn(async () => { throw new Error("You can't review your own pull request") }) })
  const { onChanged } = setup({ actions })
  fireEvent.click(screen.getByText('Approve'))
  await waitFor(() => expect(toast).toHaveBeenCalledWith("Approve failed: You can't review your own pull request", 'error'))
  expect(onChanged).not.toHaveBeenCalled()
})

it('merge warnings toast separately', async () => {
  const w = 'Merged, but the branch could not be deleted: x'
  const actions = mk({ merge: vi.fn(async () => ({ patch: { status: 'merged' }, warnings: [w] })) })
  setup({ actions })
  fireEvent.click(screen.getByText('Merge'))
  const dlg = await screen.findByRole('dialog')
  await within(dlg).findByRole('option', { name: 'Squash' })
  fireEvent.click(within(dlg).getByRole('button', { name: 'Merge' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith(w, 'warning'))
  expect(toast).toHaveBeenCalledWith('Merged', 'success')
})
