import { describe, it, expect, vi } from 'vitest'
import { createRoutedWorkItemSource } from '../src/views/work-item-source.js'

function fakeSource(name) {
  return {
    loadDetail: vi.fn(async () => name), loadComments: vi.fn(async () => [name]),
    addComment: vi.fn(async () => ({ id: name })), saveField: vi.fn(async () => {}),
    loadRawFields: vi.fn(async () => ({ src: name })), createWorkItem: vi.fn(async () => ({ id: 1, warnings: [] })),
    moveToCategory: vi.fn(async () => ({ state: name, stateCategory: 'Completed' })),
    webUrl: vi.fn(item => `${name}:${item.id}`),
  }
}

describe('createRoutedWorkItemSource', () => {
  it('routes numeric ids to ADO and jira: ids to Jira', async () => {
    const ado = fakeSource('ado'); const jira = fakeSource('jira')
    const s = createRoutedWorkItemSource({ ado, jira })
    expect(await s.loadDetail(7, 'p')).toBe('ado')
    expect(await s.loadDetail('jira:A-1', 'p')).toBe('jira')
    await s.saveField('jira:A-1', 'System.State', 'Done')
    expect(jira.saveField).toHaveBeenCalledWith('jira:A-1', 'System.State', 'Done')
    expect(ado.saveField).not.toHaveBeenCalled()
    expect(await s.loadRawFields(7)).toEqual({ src: 'ado' })
    expect(s.jira).toBe(jira)
  })

  it('rejects Jira ids when Jira is not configured', async () => {
    const s = createRoutedWorkItemSource({ ado: fakeSource('ado'), jira: null })
    await expect(s.loadComments('jira:A-1')).rejects.toThrow('Jira is not configured')
  })

  it('creates through ADO by default', async () => {
    const ado = fakeSource('ado')
    await createRoutedWorkItemSource({ ado }).createWorkItem({ project: 'p' })
    expect(ado.createWorkItem).toHaveBeenCalledWith({ project: 'p' })
  })

  it('routes moveToCategory and webUrl, tolerating sources without them', async () => {
    const ado = { ...fakeSource('ado'), moveToCategory: undefined, webUrl: undefined }
    const s = createRoutedWorkItemSource({ ado, jira: fakeSource('jira') })
    expect(await s.moveToCategory('jira:A-1', 'Completed', {})).toEqual({ state: 'jira', stateCategory: 'Completed' })
    await expect(s.moveToCategory(7, 'Completed', {})).rejects.toThrow('not supported')
    expect(s.webUrl({ id: 'jira:A-1' })).toBe('jira:jira:A-1')
    expect(s.webUrl({ id: 7 })).toBeNull()
    expect(await s.availableTargetStates(7)).toBeNull()
  })

  it('routes moveToStatuses to the item\'s provider and rejects when unsupported', async () => {
    const jira = { ...fakeSource('jira'), moveToStatuses: vi.fn(async () => ({ state: 'Code Review', stateCategory: 'InProgress' })) }
    const s = createRoutedWorkItemSource({ ado: fakeSource('ado'), jira })
    expect(await s.moveToStatuses('jira:A-1', ['In Progress', 'Code Review'], { state: 'To Do' }))
      .toEqual({ state: 'Code Review', stateCategory: 'InProgress' })
    expect(jira.moveToStatuses).toHaveBeenCalledWith('jira:A-1', ['In Progress', 'Code Review'], { state: 'To Do' })
    await expect(s.moveToStatuses(7, ['Done'], {})).rejects.toThrow('Moving between columns is not supported for this item')
  })
})
