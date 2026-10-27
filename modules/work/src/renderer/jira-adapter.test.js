import { describe, it, expect, vi } from 'vitest'
import { jiraAdapter } from './jira-adapter.js'

describe('jiraAdapter', () => {
  it('sends the request through the main process bridge', async () => {
    window.electronAPI = { jira: { request: vi.fn(async () => ({ status: 200 })) } }
    expect(await jiraAdapter.request({ path: '/x' })).toEqual({ status: 200 })
    expect(window.electronAPI.jira.request).toHaveBeenCalledWith({ path: '/x' })
    delete window.electronAPI
  })
})
