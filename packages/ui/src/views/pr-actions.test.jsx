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

it('a vote kept for later shows the queued toast instead of the success one', async () => {
  const { QUEUED_TOAST } = await import('../offline-queued.js')
  const actions = mk({ approve: vi.fn(async () => ({ patch: { myVote: 10 }, warnings: [], queued: true })) })
  const { onChanged } = setup({ actions })
  fireEvent.click(screen.getByText('Approve'))
  await waitFor(() => expect(toast).toHaveBeenCalledWith(QUEUED_TOAST, 'success'))
  expect(toast).not.toHaveBeenCalledWith('Approved', 'success')
  expect(onChanged).toHaveBeenCalledWith({ myVote: 10 })
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

it('toasts "Merge requested" when a merge returns an empty patch', async () => {
  const actions = mk({ merge: vi.fn(async () => ({ patch: {}, warnings: ['Completion queued — Azure DevOps reports queued'] })) })
  const { onChanged } = setup({ actions })
  fireEvent.click(screen.getByText('Merge'))
  const dlg = await screen.findByRole('dialog')
  await within(dlg).findByRole('option', { name: 'Squash' })
  fireEvent.click(within(dlg).getByRole('button', { name: 'Merge' }))
  await waitFor(() => expect(toast).toHaveBeenCalledWith('Merge requested', 'success'))
  expect(toast).not.toHaveBeenCalledWith('Merged', 'success')
  expect(toast).toHaveBeenCalledWith('Completion queued — Azure DevOps reports queued', 'warning')
  expect(onChanged).toHaveBeenCalledWith({})
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

// Merging with "Delete source branch" ticked closes every other open PR that targets that branch (GitHub), so the dialog
// looks for them first, says which they are, and leaves the branch alone unless asked.
const STACKED = [{ id: 8, label: '#8', title: 'Next in the stack' }, { id: 9, label: '#9', title: 'Another' }]
const openDialog = async (actions, pr = PR) => {
  setup({ actions, pr })
  fireEvent.click(screen.getByText('Merge'))
  const dlg = await screen.findByRole('dialog', { name: 'Merge pull request' })
  await within(dlg).findByRole('option', { name: 'Squash' })
  return dlg
}

it('merge dialog: with PRs that target the branch it warns, names them, and does not delete the branch by default', async () => {
  const actions = mk({ mergeOptions: vi.fn(async () => ({ methods: METHODS, rejectConfirm: 'x', dependents: STACKED })) })
  const dlg = await openDialog(actions, { ...PR, source: 'github' })
  const alert = within(dlg).getByRole('alert')
  expect(alert.textContent).toContain('2 open pull requests target this branch')
  expect(alert.textContent).toContain('#8 Next in the stack')
  expect(alert.textContent).toContain('#9 Another')
  expect(alert.textContent).toContain('would close them')
  expect(within(dlg).getByLabelText('Delete source branch').checked).toBe(false)
  fireEvent.click(within(dlg).getByRole('button', { name: 'Merge' }))
  await waitFor(() => expect(actions.merge).toHaveBeenCalled())
  expect(actions.merge).toHaveBeenCalledWith({ ...PR, source: 'github' }, { method: 'squash', deleteBranch: false })
})

it('merge dialog: the branch can still be deleted on purpose', async () => {
  const actions = mk({ mergeOptions: vi.fn(async () => ({ methods: METHODS, rejectConfirm: 'x', dependents: STACKED })) })
  const dlg = await openDialog(actions)
  fireEvent.click(within(dlg).getByLabelText('Delete source branch'))
  fireEvent.click(within(dlg).getByRole('button', { name: 'Merge' }))
  await waitFor(() => expect(actions.merge).toHaveBeenCalled())
  expect(actions.merge).toHaveBeenCalledWith(PR, { method: 'squash', deleteBranch: true })
})

it('merge dialog: one dependent reads in the singular, and Azure DevOps says what really happens there', async () => {
  const actions = mk({ mergeOptions: vi.fn(async () => ({ methods: METHODS, rejectConfirm: 'x', dependents: [STACKED[0]] })) })
  const dlg = await openDialog(actions, { ...PR, source: 'ado' })
  const text = within(dlg).getByRole('alert').textContent
  expect(text).toContain('1 open pull request targets this branch')
  expect(text).toContain('no target branch')
  expect(text).not.toContain('would close them')
})

it('merge dialog: when the check could not be made it says so and keeps the branch', async () => {
  const actions = mk({ mergeOptions: vi.fn(async () => ({ methods: METHODS, rejectConfirm: 'x', dependents: [], dependentsError: true })) })
  const dlg = await openDialog(actions)
  expect(within(dlg).getByRole('alert').textContent).toContain('could not check')
  expect(within(dlg).getByLabelText('Delete source branch').checked).toBe(false)
})

it('merge dialog: with nothing depending on the branch there is no warning and the branch is deleted as before', async () => {
  const actions = mk({ mergeOptions: vi.fn(async () => ({ methods: METHODS, rejectConfirm: 'x', dependents: [] })) })
  const dlg = await openDialog(actions)
  expect(within(dlg).queryByRole('alert')).toBeNull()
  expect(within(dlg).getByLabelText('Delete source branch').checked).toBe(true)
})

it('merge dialog: a long list of dependents is cut short and says how many more', async () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: 20 + i, label: `#${20 + i}`, title: `T${i}` }))
  const actions = mk({ mergeOptions: vi.fn(async () => ({ methods: METHODS, rejectConfirm: 'x', dependents: many })) })
  const dlg = await openDialog(actions)
  const text = within(dlg).getByRole('alert').textContent
  expect(text).toContain('8 open pull requests target this branch')
  expect(text).toContain('#24 T4')
  expect(text).not.toContain('#25')
  expect(text).toContain('and 3 more')
})
