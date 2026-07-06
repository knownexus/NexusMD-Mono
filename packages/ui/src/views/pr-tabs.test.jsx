import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PRCommitsTab, PRFilesTab, PRTabs } from './pr-tabs.jsx'

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

describe('PRTabs', () => {
  const pr = {
    id: 5, repoId: 'r1', project: 'Proj', org: 'myorg', repo: 'myrepo',
    title: 'Add feature', status: 'active', draft: false,
    description: 'Some description', reviewerDetails: [], linkedWorkItems: [], url: 'https://x',
  }

  it('renders the description and switches to the Files tab', async () => {
    const http = makeHttp([
      { match: '/threads?api-version', json: { value: [] } },
    ])
    render(<PRTabs pr={pr} http={http} />)
    expect(screen.getByText('Some description')).toBeTruthy()
    fireEvent.click(screen.getByText('Files'))
    expect(screen.getByText('Loading files…')).toBeTruthy()
  })

  it('lets the user edit and save the description', async () => {
    const http = makeHttp([
      { match: '/threads?api-version', json: { value: [] } },
      { match: 'pullRequests/5?api-version', json: { id: 5, description: 'Updated text' } },
    ])
    render(<PRTabs pr={pr} http={http} />)
    fireEvent.click(screen.getByText('Edit'))
    const textarea = screen.getByRole('textbox', { name: '' }) || screen.getAllByRole('textbox')[0]
    fireEvent.change(textarea, { target: { value: 'Updated text' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByText(/Saved/)).toBeTruthy())
  })

  it('posts a new top-level comment', async () => {
    const http = makeHttp([
      { match: '/threads?api-version', json: { value: [] } },
    ])
    render(<PRTabs pr={pr} http={http} />)
    const box = screen.getByPlaceholderText('Add a comment…')
    fireEvent.change(box, { target: { value: 'Looks good' } })
    fireEvent.click(screen.getByText('Post comment'))
    await waitFor(() => expect(screen.getByText('Looks good')).toBeTruthy())
  })

  it('resolves an open thread', async () => {
    const http = makeHttp([
      { match: '/threads?api-version', json: { value: [
        { id: 1, status: 'active', comments: [{ id: 10, commentType: 1, content: 'A comment', author: { displayName: 'Alex' } }] },
      ] } },
      { match: '/threads/1?api-version', json: { id: 1, status: 'fixed' } },
    ])
    render(<PRTabs pr={pr} http={http} />)
    await waitFor(() => expect(screen.getByText('Resolve')).toBeTruthy())
    fireEvent.click(screen.getByText('Resolve'))
    await waitFor(() => expect(screen.getByText('Re-open')).toBeTruthy())
  })

  it('does not clobber an optimistically-posted comment when the slow initial thread fetch resolves afterward', async () => {
    // Regression test: the initial GET /threads is deliberately held open (via a
    // manually-resolved promise) so it resolves *after* the user posts a comment.
    // POST /threads (same path, different method) resolves immediately. Before the
    // fix, the late GET's `.then` unconditionally replaced threadState wholesale,
    // wiping out the optimistic/confirmed comment even though it succeeded server-side.
    let resolveInitialFetch
    const initialFetchGate = new Promise(resolve => { resolveInitialFetch = resolve })
    const http = {
      fetch: vi.fn(async (path, options) => {
        if (path.includes('/threads?api-version') && options && options.method === 'POST') {
          return {
            ok: true, status: 200,
            json: async () => ({
              id: 99, status: 'active',
              comments: [{ id: 100, commentType: 1, content: 'Race comment', author: { displayName: 'You' } }],
            }),
            text: async () => '',
          }
        }
        if (path.includes('/threads?api-version')) {
          await initialFetchGate
          return { ok: true, status: 200, json: async () => ({ value: [] }), text: async () => '' }
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
      }),
    }
    render(<PRTabs pr={pr} http={http} />)
    const box = screen.getByPlaceholderText('Add a comment…')
    fireEvent.change(box, { target: { value: 'Race comment' } })
    fireEvent.click(screen.getByText('Post comment'))
    await waitFor(() => expect(screen.getByText('Race comment')).toBeTruthy())

    // Now let the delayed initial fetch resolve — it must not wipe the comment out.
    resolveInitialFetch()
    await waitFor(() => expect(screen.getByText('Race comment')).toBeTruthy())
  })
})
