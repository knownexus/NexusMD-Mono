// packages/ui/src/views/view-api-client.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react'

vi.mock('@nexusmd/core', async importOriginal => ({
  ...(await importOriginal()),
  loadCollection: vi.fn(async (_file, dir) => ({ dir, meta: { name: `Collection ${dir}`, tree: [] }, requests: {}, environments: {} })),
}))

import { loadCollection } from '@nexusmd/core'
import { ApiClientView } from './view-api-client.jsx'
import { ApiClientProvider } from '../api-client-context.jsx'

const DIR = 'C:/api/orders'
const adapters = { file: {}, scriptRunner: {} }

function show() {
  return render(<ApiClientProvider adapters={adapters}><ApiClientView /></ApiClientProvider>)
}
const withFolders = existing => { window.electronAPI = { file: { exists: vi.fn(async p => existing.has(p)) } } }
const row = () => screen.getByTitle(`Not on this computer: ${DIR}`)

beforeEach(() => { loadCollection.mockClear(); localStorage.setItem('nexusmd.apiClient.loadedDirs', JSON.stringify([DIR])) })
afterEach(() => { cleanup(); localStorage.clear(); delete window.electronAPI })

describe('API client folders missing on this computer', () => {
  it('a folder that is missing is shown disabled and cannot be opened', async () => {
    withFolders(new Set())
    show()
    await waitFor(() => expect(row().getAttribute('aria-disabled')).toBe('true'))
    // Nothing to expand or run in a folder that is not there.
    fireEvent.click(row())
    expect(screen.queryByText('Run collection')).toBeNull()
    expect(screen.queryByTitle('New request')).toBeNull()
    // It can still be removed from the profile.
    expect(screen.getByTitle('Remove')).toBeTruthy()
  })

  it('it enables once the folder exists', async () => {
    withFolders(new Set())
    show()
    await waitFor(() => expect(row().getAttribute('aria-disabled')).toBe('true'))
    withFolders(new Set([DIR]))
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(screen.getByText(`Collection ${DIR}`)).toBeTruthy())
    expect(screen.queryByTitle(`Not on this computer: ${DIR}`)).toBeNull()
    expect(screen.getByText('Run collection')).toBeTruthy()
  })

  it('retries loading a folder whose first load failed while it was missing, once it exists', async () => {
    withFolders(new Set())
    loadCollection.mockRejectedValueOnce(new Error('ENOENT'))
    show()
    await waitFor(() => expect(row().getAttribute('aria-disabled')).toBe('true'))
    expect(loadCollection).toHaveBeenCalledTimes(1)
    withFolders(new Set([DIR]))
    act(() => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(screen.getByText(`Collection ${DIR}`)).toBeTruthy())
    expect(loadCollection).toHaveBeenCalledTimes(2)
  })

  it('treats a folder as present when the host cannot check', async () => {
    show()
    await waitFor(() => expect(screen.getByText(`Collection ${DIR}`)).toBeTruthy())
    expect(screen.queryByTitle(`Not on this computer: ${DIR}`)).toBeNull()
  })
})
