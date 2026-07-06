import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PRCommitsTab, PRFilesTab } from './pr-tabs.jsx'

afterEach(cleanup)

function makeHttp(responses) {
  return {
    fetch: vi.fn(async (path) => {
      const match = responses.find(r => path.includes(r.match))
      if (!match) return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
      return { ok: match.ok !== false, status: match.status || 200, json: async () => match.json ?? {}, text: async () => match.text ?? '' }
    }),
  }
}

const pr = { id: 5, repoId: 'r1', project: 'Proj', repo: 'myrepo' }

describe('PRCommitsTab', () => {
  it('shows a loading state then the commit list', async () => {
    const http = makeHttp([{ match: '/commits?api-version', json: { value: [
      { commitId: 'abcdef1234567', comment: 'Fix bug\n\nDetails', author: { name: 'Alex', date: '2026-01-01T00:00:00Z' } },
    ] } }])
    render(<PRCommitsTab pr={pr} http={http} />)
    expect(screen.getByText('Loading commits…')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Fix bug')).toBeTruthy())
    expect(screen.getByText('abcdef1')).toBeTruthy()
  })

  it('shows an empty state when there are no commits', async () => {
    const http = makeHttp([{ match: '/commits?api-version', json: { value: [] } }])
    render(<PRCommitsTab pr={pr} http={http} />)
    await waitFor(() => expect(screen.getByText('No commits found.')).toBeTruthy())
  })
})

describe('PRFilesTab', () => {
  it('lists changed files and expands a diff on click', async () => {
    const http = makeHttp([
      { match: '/iterations?api-version', json: { value: [{ id: 1, sourceRefCommit: { commitId: 'src1' }, targetRefCommit: { commitId: 'base1' } }] } },
      { match: '/iterations/1/changes', json: { changeEntries: [{ item: { path: '/src/a.js' }, changeType: 'edit' }] } },
      { match: '/items?path=', text: 'line1\nline2' },
    ])
    render(<PRFilesTab pr={pr} http={http} />)
    await waitFor(() => expect(screen.getByText('1 file changed')).toBeTruthy())
    fireEvent.click(screen.getByText('a.js'))
    await waitFor(() => expect(screen.getByText('line1')).toBeTruthy())
  })

  it('shows an empty state when there are no file changes', async () => {
    const http = makeHttp([
      { match: '/iterations?api-version', json: { value: [{ id: 1, sourceRefCommit: {}, targetRefCommit: {} }] } },
      { match: '/iterations/1/changes', json: { changeEntries: [] } },
    ])
    render(<PRFilesTab pr={pr} http={http} />)
    await waitFor(() => expect(screen.getByText('No file changes found.')).toBeTruthy())
  })
})
