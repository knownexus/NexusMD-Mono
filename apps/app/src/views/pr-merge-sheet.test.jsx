import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

import { PRMergeSheet, canMerge, canClose, OFFLINE_MERGE } from './pr-merge-sheet.jsx'

afterEach(cleanup)

const gh = { id: 'gh:a/b#3', displayId: 'a/b#3', source: 'github', repo: 'a/b', number: 3, status: 'active', draft: false, title: 'Add retries' }
const actions = (over = {}) => ({
  mergeOptions: vi.fn(async () => ({ methods: [{ id: 'squash', label: 'Squash' }, { id: 'merge', label: 'Merge' }] })),
  merge: vi.fn(async () => ({ patch: { status: 'merged' }, warnings: [] })),
  reject: vi.fn(async () => ({ patch: { status: 'abandoned' }, warnings: [] })),
  ...over,
})
const mount = (props) => render(<PRMergeSheet pr={gh} mode="merge" adoMeId="me" onClose={() => {}} {...props}/>)

describe('when a PR can be merged or closed', () => {
  it('merges only open non-drafts, closes open or draft ones', () => {
    expect(canMerge(gh)).toBe(true)
    expect(canMerge({ ...gh, draft: true })).toBe(false)
    expect(canMerge({ ...gh, status: 'merged' })).toBe(false)
    expect(canClose({ ...gh, status: 'draft' })).toBe(true)
    expect(canClose({ ...gh, status: 'abandoned' })).toBe(false)
  })
})

describe('merge sheet', () => {
  it("offers the repository's merge types and merges with the choice and branch deletion", async () => {
    const a = actions()
    const onDone = vi.fn()
    const onClose = vi.fn()
    mount({ makeActions: () => a, onDone, onClose })
    fireEvent.change(await screen.findByLabelText('Merge type'), { target: { value: 'merge' } })
    fireEvent.click(screen.getByLabelText(/Delete the source branch/))
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(a.merge).toHaveBeenCalledWith(gh, { method: 'merge', deleteBranch: false })
    expect(onDone.mock.calls[0][0]).toMatchObject({ merged: true })
    expect(onClose).toHaveBeenCalled()
  })

  it('will not merge while offline, and says why', async () => {
    const a = actions()
    mount({ makeActions: () => a, online: () => false })
    await screen.findByLabelText('Merge type')
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect((await screen.findByRole('alert')).textContent).toBe(OFFLINE_MERGE)
    expect(a.merge).not.toHaveBeenCalled()
  })

  it("shows the provider's refusal and stays open", async () => {
    const a = actions({ merge: vi.fn(async () => { throw new Error('Pull request is not mergeable') }) })
    const onClose = vi.fn()
    mount({ makeActions: () => a, onClose })
    await screen.findByLabelText('Merge type')
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/not mergeable/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a repository that allows no merge methods', async () => {
    mount({ makeActions: () => actions({ mergeOptions: vi.fn(async () => ({ methods: [] })) }) })
    expect(await screen.findByText(/allows no merge methods/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Merge' }).disabled).toBe(true)
  })

  it('passes the warnings from the provider back', async () => {
    const a = actions({ merge: vi.fn(async () => ({ patch: { status: 'merged' }, warnings: ['Merged, but the branch could not be deleted'] })) })
    const onDone = vi.fn()
    mount({ makeActions: () => a, onDone })
    await screen.findByLabelText('Merge type')
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(onDone.mock.calls[0][0].warnings).toEqual(['Merged, but the branch could not be deleted'])
  })
})

describe('close sheet', () => {
  it('closes without merging, saying what it will do', async () => {
    const a = actions()
    const onDone = vi.fn()
    render(<PRMergeSheet pr={gh} mode="close" onClose={() => {}} onDone={onDone} makeActions={() => a}/>)
    expect(screen.getByText(/without merging it/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close it' }))
    await waitFor(() => expect(a.reject).toHaveBeenCalledWith(gh))
    expect(onDone.mock.calls[0][0].merged).toBe(false)
  })

  it('uses Azure DevOps wording for an ADO PR', () => {
    render(<PRMergeSheet pr={{ id: 9, status: 'active', repoId: 'r', project: 'P', title: 'x' }} mode="close" onClose={() => {}} makeActions={() => actions()}/>)
    expect(screen.getByText(/abandons the pull request/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abandon it' })).toBeTruthy()
  })
})
