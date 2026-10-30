import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { GithubCreateForm } from './github-create-form.jsx'

afterEach(() => cleanup())

const META = {
  'acme/web': { labels: ['bug', 'docs'], assignees: ['octo', 'hubot'], milestones: [{ number: 3, title: 'v2' }] },
  'acme/api': { labels: ['api'], assignees: ['octo'], milestones: [] },
}
function makeSource({ createError = null } = {}) {
  return {
    getCreateMeta: vi.fn(async (repo) => META[repo]),
    createIssue: vi.fn(async ({ repo }) => { if (createError) throw createError; return { id: `gh:${repo}#9`, url: 'u', warnings: [] } }),
  }
}
const pick = (select, values) => {
  for (const o of select.options) o.selected = values.includes(o.value)
  fireEvent.change(select)
}

describe('GithubCreateForm', () => {
  it('loads create meta for the first repo, and again for a newly chosen one', async () => {
    const source = makeSource()
    render(<GithubCreateForm source={source} repos={['acme/web', 'acme/api']} />)
    await waitFor(() => expect(source.getCreateMeta).toHaveBeenCalledWith('acme/web'))
    expect(await screen.findByRole('option', { name: 'docs' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/api' } })
    await waitFor(() => expect(source.getCreateMeta).toHaveBeenCalledWith('acme/api'))
    expect(await screen.findByRole('option', { name: 'api' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'docs' })).toBeNull()
  })

  it('keeps Create disabled until there is a title', async () => {
    render(<GithubCreateForm source={makeSource()} repos={['acme/web']} />)
    expect(screen.getByRole('button', { name: 'Create issue' }).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: 'Create issue' }).disabled).toBe(false)
  })

  it('creates with exactly the repo, title, body, labels, assignees and milestone', async () => {
    const source = makeSource()
    const onCreated = vi.fn()
    render(<GithubCreateForm source={source} repos={['acme/web']} defaultTitle="From planner" onCreated={onCreated} />)
    await screen.findByRole('option', { name: 'docs' })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: '**bold**' } })
    pick(screen.getByLabelText('Labels'), ['bug', 'docs'])
    pick(screen.getByLabelText('Assignees'), ['hubot'])
    fireEvent.change(screen.getByLabelText('Milestone'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    await waitFor(() => expect(source.createIssue).toHaveBeenCalledWith({
      repo: 'acme/web', title: 'From planner', body: '**bold**', labels: ['bug', 'docs'], assignees: ['hubot'], milestone: 3,
    }))
    expect(onCreated).toHaveBeenCalledWith({ id: 'gh:acme/web#9', url: 'u', warnings: [] })
  })

  it('shows the error and keeps the input when creating fails', async () => {
    const source = makeSource({ createError: new Error('Validation Failed') })
    render(<GithubCreateForm source={source} repos={['acme/web']} defaultTitle="Keep me" />)
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }))
    expect(await screen.findByText(/Validation Failed/)).toBeTruthy()
    expect(screen.getByLabelText('Title').value).toBe('Keep me')
  })

  it('reports title edits so a provider switch can keep them', () => {
    const onTitleChange = vi.fn()
    render(<GithubCreateForm source={makeSource()} repos={['acme/web']} onTitleChange={onTitleChange} />)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'typed' } })
    expect(onTitleChange).toHaveBeenCalledWith('typed')
  })
})
