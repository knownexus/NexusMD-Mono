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

describe('PRTabs for a GitHub pull request', () => {
  const ghPr = {
    id: 'gh:acme/web#7', source: 'github', number: 7, repo: 'acme/web', displayId: 'acme/web#7',
    description: 'PR **body**', reviewerDetails: [{ name: 'r1', vote: 10, id: 'r1' }],
    linkedWorkItems: [{ id: 'gh:acme/web#4' }],
  }
  const GH = {
    'repos/acme/web/pulls/7/commits': [{ sha: 'abc1234ffff', author: { login: 'octo' }, commit: { message: 'Add it', author: { name: 'Octo', date: '2026-01-01T00:00:00Z' } } }],
    'repos/acme/web/pulls/7/files': [{ filename: 'src/a.js', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-old line\n+new line' }],
    'repos/acme/web/issues/7/comments': [{ id: 50, user: { login: 'pm' }, body: 'ship it', created_at: '2026-01-01T00:00:00Z' }],
    'repos/acme/web/pulls/7/comments': [{ id: 1, path: 'src/a.js', line: 2, user: { login: 'r1' }, body: 'why?', created_at: '2026-01-01T00:00:00Z' }],
  }
  const ghHttp = () => ({
    fetch: vi.fn(async (path, opts = {}) => {
      const key = path.split('?')[0]
      const body = opts.method === 'POST' ? { id: 51, user: { login: 'me' }, body: JSON.parse(opts.body).body, created_at: '2026-01-02T00:00:00Z' } : (GH[key] ?? [])
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body }
    }),
  })
  const renderGh = async () => {
    const { NexusDataProvider } = await import('../data-context.jsx')
    const http = makeHttp([])
    const githubHttp = ghHttp()
    render(<NexusDataProvider value={{ data: {}, githubHttp }}><PRTabs pr={ghPr} http={http} /></NexusDataProvider>)
    return { http, githubHttp }
  }

  it('shows the conversation and review threads from GitHub, never asking ADO', async () => {
    const { http } = await renderGh()
    expect(await screen.findByText('ship it')).toBeTruthy()
    expect(screen.getByText('why?')).toBeTruthy()
    expect(screen.getByText('src/a.js:2')).toBeTruthy()
    expect(screen.getByText('acme/web#4')).toBeTruthy()
    expect(http.fetch).not.toHaveBeenCalled()
  })

  it('has no thread status or description editing controls', async () => {
    await renderGh()
    await screen.findByText('ship it')
    expect(screen.queryByRole('button', { name: /Resolve|Re-open/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
    expect(screen.getByText('body')).toBeTruthy()
  })

  it('posts a comment to the PR conversation', async () => {
    const { githubHttp } = await renderGh()
    await screen.findByText('ship it')
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'looks good' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(await screen.findByText('looks good')).toBeTruthy()
    const post = githubHttp.fetch.mock.calls.find(([, o]) => o?.method === 'POST')
    expect(post[0]).toBe('repos/acme/web/issues/7/comments')
  })

  it('loads commits and files from GitHub', async () => {
    const { http } = await renderGh()
    fireEvent.click(screen.getByRole('button', { name: 'Commits' }))
    expect(await screen.findByText('Add it')).toBeTruthy()
    expect(screen.getByText('abc1234')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(await screen.findByText('1 file changed')).toBeTruthy()
    fireEvent.click(screen.getByText('a.js'))
    expect(await screen.findByText('new line')).toBeTruthy()
    expect(http.fetch).not.toHaveBeenCalled()
  })
})
