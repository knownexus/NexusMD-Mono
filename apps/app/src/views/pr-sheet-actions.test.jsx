import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

const run = vi.fn()
vi.mock('../offline-queue-app.js', () => ({ appQueue: { run: (...a) => run(...a), count: () => 0 } }))

import { PRSheetActions } from './pr-sheet-actions.jsx'

const ado = { id: 7, displayId: '7', status: 'active', draft: false, project: 'P', repoId: 'r', reviewerDetails: [] }
beforeEach(() => { run.mockReset(); run.mockResolvedValue({ done: true }) })
afterEach(cleanup)

describe('PR sheet vote and comment', () => {
  it('votes, tells you, and offers Undo that resets the vote', async () => {
    const onFlash = vi.fn()
    render(<PRSheetActions pr={ado} me={{ adoId: 'me' }} onFlash={onFlash}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(onFlash).toHaveBeenCalled())
    expect(run.mock.calls[0][0]).toBe('pr.vote')
    expect(run.mock.calls[0][1]).toMatchObject({ vote: 10, adoId: 'me' })
    const [msg, , undo] = onFlash.mock.calls[0]
    expect(msg).toBe('Voted: Approve')
    await undo()
    expect(run.mock.calls[1][1]).toMatchObject({ vote: 0 })
  })

  it('says a vote was saved for later when offline, with no Undo', async () => {
    run.mockResolvedValue({ queued: true })
    const onFlash = vi.fn()
    render(<PRSheetActions pr={ado} me={{ adoId: 'me' }} onFlash={onFlash}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(onFlash).toHaveBeenCalled())
    expect(onFlash.mock.calls[0][0]).toMatch(/back online/)
    expect(onFlash.mock.calls[0][2]).toBeUndefined()
  })

  it('shows a refusal instead of failing silently', async () => {
    run.mockRejectedValue(new Error('TF401027: no permission'))
    render(<PRSheetActions pr={ado} me={{ adoId: 'me' }} onFlash={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/no permission/)
  })

  it('posts a comment and clears the box', async () => {
    const onFlash = vi.fn()
    render(<PRSheetActions pr={ado} me={{ adoId: 'me' }} onFlash={onFlash}/>)
    const post = screen.getByRole('button', { name: 'Post comment' })
    expect(post.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Comment', { selector: 'textarea' }), { target: { value: ' Looks good ' } })
    fireEvent.click(post)
    await waitFor(() => expect(onFlash).toHaveBeenCalledWith('Comment posted', 'check'))
    expect(run.mock.calls[0][1]).toMatchObject({ text: 'Looks good' })
    expect(screen.getByLabelText('Comment', { selector: 'textarea' }).value).toBe('')
  })

  it('looks up your ADO identity when the data lacks it, then offers votes', async () => {
    const lookup = vi.fn(async () => 'found-id')
    render(<PRSheetActions pr={ado} me={{}} onFlash={vi.fn()} lookupAdoId={lookup}/>)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(run).toHaveBeenCalled())
    expect(run.mock.calls[0][1].adoId).toBe('found-id')
  })

  it('gives a GitHub PR approve and request changes, with no undo', async () => {
    const onFlash = vi.fn()
    render(<PRSheetActions pr={{ id: 'gh:a/b#1', source: 'github', repo: 'a/b', number: 1, status: 'active', reviewerDetails: [] }} me={{}} onFlash={onFlash}/>)
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(onFlash).toHaveBeenCalled())
    expect(run.mock.calls[0][1].vote).toBe('APPROVE')
    expect(onFlash.mock.calls[0][2]).toBeUndefined()
  })
})
