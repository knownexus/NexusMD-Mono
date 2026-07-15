import { it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { ApiClientProvider, ApiClientView } from '../src/index.js'
import { createCollection, writeRequest, writeCollectionMeta } from '@nexusmd/core'

afterEach(cleanup)

function memFile(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    async read(path) { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path) },
    async write(path, text) { files.set(path, text) },
    async exists(path) { return files.has(path) },
    async list(dirPath) {
      const prefix = dirPath + '/'
      return [...files.keys()].filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length))
    },
    async delete(path) { files.delete(path) },
    async mkdir() {},
  }
}

function fakeScriptRunner() {
  return { run: async (_script, context) => ({ context, logs: [], error: null }) }
}

function renderApiClient({ file, apiHttp, scriptRunner } = {}) {
  const adapters = {
    file: file || memFile(),
    scriptRunner: scriptRunner || fakeScriptRunner(),
    secureStorage: { get: async () => null, set: async () => {}, remove: async () => {} },
    apiHttp: apiHttp || { fetch: async () => ({ status: 200, statusText: 'OK', headers: {}, text: async () => '' }) },
  }
  return render(
    <ApiClientProvider adapters={adapters}>
      <ApiClientView />
    </ApiClientProvider>,
  )
}

// The sidebar's "Import Postman collection" textarea is always present once a
// collection is open, so a bare `querySelector('textarea')` would match it
// instead of the request-editor's Body-tab textarea. That import textarea is
// the only one with a placeholder; the body textarea has none.
function bodyTextarea(container) {
  return [...container.querySelectorAll('textarea')].find(t => !t.placeholder)
}

async function openCollectionAndCreateRequest(rr) {
  const { getByPlaceholderText, getByText, getByTitle } = rr
  fireEvent.change(getByPlaceholderText('Collection folder path'), { target: { value: '/col' } })
  fireEvent.click(getByText('Open'))
  await waitFor(() => getByTitle('New request'))
  fireEvent.click(getByTitle('New request'))
  await waitFor(() => getByText('Save'))
}

it('shows an unavailable fallback when the host has no scriptRunner/file adapter (e.g. web today)', () => {
  const { container } = render(
    <ApiClientProvider adapters={{}}>
      <ApiClientView />
    </ApiClientProvider>
  )
  expect(container.textContent).toContain("isn't available on this platform yet")
})

it('does not attempt to open/mkdir an empty path — shows a guidance error instead', async () => {
  const file = memFile()
  const mkdir = vi.spyOn(file, 'mkdir')
  const adapters = { file, scriptRunner: fakeScriptRunner(), secureStorage: { get: async () => null }, apiHttp: { fetch: async () => ({}) } }

  const { container, getByText } = render(
    <ApiClientProvider adapters={adapters}>
      <ApiClientView />
    </ApiClientProvider>
  )

  fireEvent.click(getByText('Open'))

  await waitFor(() => expect(container.textContent).toContain('Choose a collection folder first'))
  expect(mkdir).not.toHaveBeenCalled()
})

it('offers a Browse button that opens a collection via the picker adapter', async () => {
  const file = memFile()
  const adapters = {
    file, scriptRunner: fakeScriptRunner(), secureStorage: { get: async () => null }, apiHttp: { fetch: async () => ({}) },
    picker: { pickDirectory: async () => '/collections/picked' },
  }

  const { container, getByTitle } = render(
    <ApiClientProvider adapters={adapters}>
      <ApiClientView />
    </ApiClientProvider>
  )

  fireEvent.click(getByTitle('Browse for folder'))

  await waitFor(() => expect(container.textContent).toContain('/collections/picked'))
})

it('lets the user open (and auto-create) a collection folder, then shows it in the sidebar', async () => {
  const file = memFile()
  const adapters = { file, scriptRunner: fakeScriptRunner(), secureStorage: { get: async () => null }, apiHttp: { fetch: async () => ({}) } }

  const { container, getByPlaceholderText, getByText } = render(
    <ApiClientProvider adapters={adapters}>
      <ApiClientView />
    </ApiClientProvider>
  )

  const input = getByPlaceholderText('Collection folder path')
  fireEvent.change(input, { target: { value: '/collections/demo' } })
  fireEvent.click(getByText('Open'))

  await waitFor(() => expect(container.textContent).toContain('/collections/demo'))
})

it('creates a new request (via the + button) and lists it in the sidebar tree', async () => {
  const file = memFile()
  const adapters = { file, scriptRunner: fakeScriptRunner(), secureStorage: { get: async () => null }, apiHttp: { fetch: async () => ({}) } }

  const { getByPlaceholderText, getByText, getByTitle } = render(
    <ApiClientProvider adapters={adapters}>
      <ApiClientView />
    </ApiClientProvider>
  )

  fireEvent.change(getByPlaceholderText('Collection folder path'), { target: { value: '/collections/demo' } })
  fireEvent.click(getByText('Open'))
  await waitFor(() => getByTitle('New request'))

  fireEvent.click(getByTitle('New request'))

  // Creating a request auto-selects it, opening the editor with the URL field.
  await waitFor(() => expect(getByPlaceholderText('https://api.example.com/{{path}}')).toBeTruthy())
  expect(getByText('New request')).toBeTruthy() // the tree node label for the newly created request
})

it('sends a request and renders the response status', async () => {
  const file = memFile()
  const apiHttp = { fetch: async () => ({ status: 200, statusText: 'OK', headers: {}, text: async () => '{"ok":true}' }) }
  const adapters = { file, scriptRunner: fakeScriptRunner(), secureStorage: { get: async () => null }, apiHttp }

  const { getByPlaceholderText, getByText, getByTitle, container } = render(
    <ApiClientProvider adapters={adapters}>
      <ApiClientView />
    </ApiClientProvider>
  )

  fireEvent.change(getByPlaceholderText('Collection folder path'), { target: { value: '/collections/demo' } })
  fireEvent.click(getByText('Open'))
  await waitFor(() => getByTitle('New request'))
  fireEvent.click(getByTitle('New request'))
  await waitFor(() => getByPlaceholderText('https://api.example.com/{{path}}'))

  fireEvent.change(getByPlaceholderText('https://api.example.com/{{path}}'), { target: { value: 'https://example.com/x' } })
  fireEvent.click(getByText('Send'))

  await waitFor(() => expect(container.textContent).toContain('200 OK'))
  expect(container.textContent).toContain('{"ok":true}')
})

it('starts with no body and shows "This request has no body."', async () => {
  const rr = renderApiClient()
  await openCollectionAndCreateRequest(rr)
  const { getByText } = rr

  fireEvent.click(getByText('Body'))
  expect(getByText('This request has no body.')).toBeTruthy()
})

it('switching body type to urlencoded shows key/value rows instead of the raw textarea', async () => {
  const rr = renderApiClient()
  await openCollectionAndCreateRequest(rr)
  const { getByText, getByLabelText, container } = rr

  fireEvent.click(getByText('Body'))
  fireEvent.change(getByLabelText('Body type'), { target: { value: 'urlencoded' } })

  expect(bodyTextarea(container)).toBeUndefined()
  expect(container.querySelectorAll('input[placeholder="key"]').length).toBeGreaterThan(0)
})

it('raw body type shows a language picker and the raw textarea', async () => {
  const rr = renderApiClient()
  await openCollectionAndCreateRequest(rr)
  const { getByText, getByLabelText, container } = rr

  fireEvent.click(getByText('Body'))
  fireEvent.change(getByLabelText('Body type'), { target: { value: 'raw' } })

  expect(getByLabelText('Raw body language')).toBeTruthy()
  expect(bodyTextarea(container)).toBeTruthy()
})

it('loading a legacy saved request (no bodyType field) with a body defaults to Raw so the body still shows', async () => {
  const file = memFile()
  await createCollection(file, '/col', { name: 'Col' })
  await writeRequest(file, '/col', 'legacy', { method: 'POST', url: '/x', body: 'legacy body text' })
  await writeCollectionMeta(file, '/col', {
    name: 'Col', description: '',
    tree: [{ type: 'request', name: 'Legacy', refId: 'legacy' }],
  })

  const rr = renderApiClient({ file })
  const { getByPlaceholderText, getByText, container } = rr
  fireEvent.change(getByPlaceholderText('Collection folder path'), { target: { value: '/col' } })
  fireEvent.click(getByText('Open'))
  await waitFor(() => getByText('Legacy'))
  fireEvent.click(getByText('Legacy'))

  fireEvent.click(getByText('Body'))
  expect(bodyTextarea(container).value).toBe('legacy body text')
})
