import React from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ CapacitorHttp: undefined }))

const fake = vi.hoisted(() => {
  const dirs = {
    '/': [{ name: 'src', path: '/src', isFolder: true }, { name: 'a.txt', path: '/a.txt', isFolder: false }],
    '/src': [{ name: 'deep', path: '/src/deep', isFolder: true }, { name: 'b.js', path: '/src/b.js', isFolder: false }],
    '/src/deep': [{ name: 'c.js', path: '/src/deep/c.js', isFolder: false }],
  }
  return {
    backend: {
      listRepos: async () => ({ repos: [{ id: 'r1', name: 'alpha', project: 'P', provider: 'ado' }], errors: [] }),
      listBranches: async () => [{ name: 'main', isDefault: true }, { name: 'dev', isDefault: false }],
      listItems: async (_r, _b, path) => dirs[path] || [],
      getFile: async (_r, _b, path) => `contents of ${path}`,
      listCommits: async () => [{ id: 'c1', shortId: 'c1', message: 'First change', author: 'me', date: '2026-11-01T10:00:00Z' }],
    },
  }
})
vi.mock('./git-backend.js', async orig => ({ ...(await orig()), makeGitBackend: () => fake.backend }))

import { GitView } from './git-view.jsx'

beforeEach(() => { localStorage.clear(); window.history.replaceState(null, '', '/git') })
afterEach(cleanup)

const wait = ms => new Promise(r => setTimeout(r, ms))
// The system back gesture: history moves, and the page hears popstate.
const swipeBack = async () => { window.history.back(); await wait(30) }
const click = async text => { fireEvent.click(await screen.findByText(text)) }
const repoList = () => document.querySelector('input[type=search]')
const openFileB = async () => {
  await click('alpha'); await click('src'); await click('b.js')
  await screen.findByText('contents of /src/b.js')
}

describe('GitView and the back gesture', () => {
  it('goes back one layer at a time: file, folder, repo root, repo list', async () => {
    render(<GitView />)
    await openFileB()
    await swipeBack()
    // The folder the file was opened from.
    expect(await screen.findByText('deep')).toBeTruthy()
    expect(screen.queryByText('contents of /src/b.js')).toBeNull()
    await swipeBack()
    expect(await screen.findByText('a.txt')).toBeTruthy()
    expect(screen.queryByText('deep')).toBeNull()
    await swipeBack()
    await waitFor(() => expect(repoList()).toBeTruthy())
  })

  it('the Back buttons take the same path, so the history matches what is on screen', async () => {
    render(<GitView />)
    await openFileB()
    fireEvent.click(screen.getByLabelText('Back'))
    expect(await screen.findByText('deep')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Back to repositories'))
    await waitFor(() => expect(repoList()).toBeTruthy())
    expect(screen.queryByText('a.txt')).toBeNull()
    expect(window.history.state?.git ?? null).toBeNull()
  })

  it('Back to repositories climbs out of a deep folder in one step', async () => {
    render(<GitView />)
    await click('alpha'); await click('src'); await click('deep')
    await screen.findByText('c.js')
    fireEvent.click(screen.getByLabelText('Back to repositories'))
    await waitFor(() => expect(repoList()).toBeTruthy())
    expect(window.history.state?.git ?? null).toBeNull()
  })

  it('a sheet closes with the gesture and leaves the repo open', async () => {
    render(<GitView />)
    await click('alpha')
    fireEvent.click(await screen.findByText('main'))
    expect(await screen.findByText('Switch branch')).toBeTruthy()
    await swipeBack()
    await waitFor(() => expect(screen.queryByText('Switch branch')).toBeNull())
    expect(screen.getByText('a.txt')).toBeTruthy()
  })

  it('picking a branch leaves no sheet behind to come back to', async () => {
    render(<GitView />)
    await click('alpha')
    fireEvent.click(await screen.findByText('main'))
    fireEvent.click(await screen.findByText('dev'))
    await waitFor(() => expect(screen.queryByText('Switch branch')).toBeNull())
    // The repo shows the new branch, and one swipe leaves it for the list.
    expect(screen.getByText('dev')).toBeTruthy()
    await swipeBack()
    await waitFor(() => expect(repoList()).toBeTruthy())
    expect(screen.queryByText('Switch branch')).toBeNull()
  })

  it('switching between Files and Commits is not a place to go back to', async () => {
    render(<GitView />)
    await click('alpha')
    fireEvent.click(await screen.findByText('Commits'))
    expect(await screen.findByText('First change')).toBeTruthy()
    await swipeBack()
    await waitFor(() => expect(repoList()).toBeTruthy())
  })

  it('a commit sheet closes with the gesture, on the Commits tab', async () => {
    render(<GitView />)
    await click('alpha')
    fireEvent.click(await screen.findByText('Commits'))
    fireEvent.click(await screen.findByText('First change'))
    expect(await screen.findByText('Author: me')).toBeTruthy()
    await swipeBack()
    await waitFor(() => expect(screen.queryByText('Author: me')).toBeNull())
    expect(screen.getByText('First change')).toBeTruthy()
  })

  it('finds its place again after another tab was visited and the gesture came back', async () => {
    const first = render(<GitView />)
    await openFileB()
    first.unmount()
    // Another tab: its own history entry, then back to the one the file was opened in.
    window.history.pushState(null, '', '/work')
    await swipeBack()
    render(<GitView />)
    expect(await screen.findByText('contents of /src/b.js')).toBeTruthy()
    await swipeBack()
    expect(await screen.findByText('deep')).toBeTruthy()
  })
})
