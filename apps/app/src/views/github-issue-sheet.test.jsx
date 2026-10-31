import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

const create = vi.fn()
const getMeta = vi.fn()
vi.mock('@nexusmd/core', async (orig) => ({
  ...(await orig()),
  makeGithubClient: () => ({}),
  fetchGithubCreateMeta: (...a) => getMeta(...a),
  createGithubIssue: (...a) => create(...a),
}))

import { GithubIssueSheet, buildIssueInput, MAX_TITLE, OFFLINE_ISSUE } from './github-issue-sheet.jsx'

afterEach(() => { cleanup(); create.mockReset(); getMeta.mockReset() })

describe('building an issue', () => {
  it('trims and shapes what the API wants', () => {
    expect(buildIssueInput({ repo: 'a/b', title: '  Fix it  ', body: ' details ', labels: ['bug'], assignee: 'octo', milestone: '3' }).input)
      .toEqual({ repo: 'a/b', title: 'Fix it', body: 'details', labels: ['bug'], assignees: ['octo'], milestone: 3 })
    expect(buildIssueInput({ repo: 'a/b', title: 'x' }).input).toMatchObject({ assignees: [], labels: [], milestone: undefined })
  })
  it('says what is wrong', () => {
    expect(buildIssueInput({ repo: '', title: 'x' }).error).toMatch(/repository/)
    expect(buildIssueInput({ repo: 'a/b', title: '   ' }).error).toMatch(/title/)
    expect(buildIssueInput({ repo: 'a/b', title: 'x'.repeat(MAX_TITLE + 1) }).error).toMatch(/under/)
  })
})

describe('new issue sheet', () => {
  const meta = { labels: ['bug', 'ui'], assignees: ['octo', 'hubot'], milestones: [{ number: 3, title: 'v2' }] }
  const mount = (props = {}) => render(<GithubIssueSheet open onClose={() => {}} repos={['a/b', 'c/d']} onCreated={() => {}} online={() => true} {...props}/>)

  it('loads the repository labels, assignees and milestones and creates the issue with them', async () => {
    getMeta.mockResolvedValue(meta)
    create.mockResolvedValue({ id: 'gh:a/b#9', url: 'u', warnings: [] })
    const onCreated = vi.fn()
    const onClose = vi.fn()
    mount({ onCreated, onClose })
    fireEvent.click(await screen.findByRole('button', { name: 'bug' }))
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'hubot' } })
    fireEvent.change(screen.getByLabelText('Milestone'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Login loops' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(create.mock.calls[0][1]).toMatchObject({ repo: 'a/b', title: 'Login loops', labels: ['bug'], assignees: ['hubot'], milestone: 3 })
    expect(onCreated.mock.calls[0][0]).toMatchObject({ id: 'gh:a/b#9', repo: 'a/b' })
    expect(onClose).toHaveBeenCalled()
  })

  it('asks for a title and does not create without one', async () => {
    getMeta.mockResolvedValue(meta)
    mount()
    await screen.findByRole('button', { name: 'bug' })
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    expect(screen.getByRole('alert').textContent).toMatch(/title/)
    expect(create).not.toHaveBeenCalled()
  })

  it('will not create while offline', async () => {
    getMeta.mockResolvedValue(meta)
    mount({ online: () => false })
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    expect(screen.getByRole('alert').textContent).toBe(OFFLINE_ISSUE)
    expect(create).not.toHaveBeenCalled()
  })

  it('still lets you create when the labels cannot be loaded, and shows a refusal', async () => {
    getMeta.mockRejectedValue(new Error('403 forbidden'))
    create.mockRejectedValue(new Error('Validation failed'))
    mount()
    expect(await screen.findByText(/You can still create the issue/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Validation failed/)
  })

  it('reloads the labels for another repository', async () => {
    getMeta.mockResolvedValue(meta)
    mount()
    await screen.findByRole('button', { name: 'bug' })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'c/d' } })
    await waitFor(() => expect(getMeta.mock.calls.at(-1)[1]).toBe('c/d'))
  })
})
