import { describe, it, expect } from 'vitest'
import { ROOT_LAYER, readLayer, readDepth, layerOf, samePlace, historyAction } from './git-layers.js'

const repo = { repo: 'r1', branch: 'main', tab: 'files', path: '/', file: null, sheet: null }

describe('readLayer', () => {
  it('reads the root from no state, another page state, or garbage', () => {
    expect(readLayer(null)).toEqual(ROOT_LAYER)
    expect(readLayer({ other: 1 })).toEqual(ROOT_LAYER)
    expect(readLayer({ git: 'x' })).toEqual(ROOT_LAYER)
  })
  it('reads a saved layer, ignoring fields of the wrong type', () => {
    expect(readLayer({ git: { ...repo, path: '/src', file: '/src/a.js' } })).toEqual({ ...repo, path: '/src', file: '/src/a.js' })
    expect(readLayer({ git: { repo: 'r1', path: 7, tab: 'nope' } })).toEqual({ ...ROOT_LAYER, repo: 'r1' })
  })
})

describe('readDepth', () => {
  it('is the saved count of layers above the list, and 0 for anything else', () => {
    expect(readDepth({ git: repo, depth: 3 })).toBe(3)
    for (const bad of [null, {}, { depth: -1 }, { depth: 1.5 }, { depth: '2' }]) expect(readDepth(bad)).toBe(0)
  })
})

describe('layerOf', () => {
  it('is the root while no repo is open, whatever else was left set', () => {
    expect(layerOf({ repo: null, branch: 'main', tab: 'commits', path: '/src', file: '/x', sheet: 'branch' })).toEqual(ROOT_LAYER)
  })
  it('names the repo by id and keeps the rest', () => {
    expect(layerOf({ repo: { id: 'r1' }, branch: 'main', tab: 'files', path: '/src', file: null, sheet: null })).toEqual({ ...repo, path: '/src' })
  })
})

describe('historyAction', () => {
  it('does nothing when the screen already is the history entry', () => {
    expect(historyAction(repo, { ...repo })).toBe('none')
  })
  it('pushes an entry for a new place: another repo, folder, file, or a sheet over it', () => {
    expect(historyAction(ROOT_LAYER, repo)).toBe('push')
    expect(historyAction(repo, { ...repo, path: '/src' })).toBe('push')
    expect(historyAction(repo, { ...repo, file: '/a.txt' })).toBe('push')
    expect(historyAction(repo, { ...repo, sheet: 'branch' })).toBe('push')
  })
  it('only rewrites the entry for a change of tab or branch, which is not a place', () => {
    expect(historyAction(repo, { ...repo, tab: 'commits' })).toBe('replace')
    expect(historyAction(repo, { ...repo, branch: 'dev' })).toBe('replace')
  })
  it('rewrites, not pushes, when a sheet is dropped by the screen itself (a branch picked)', () => {
    expect(historyAction({ ...repo, sheet: 'branch' }, { ...repo, branch: 'dev' })).toBe('replace')
  })
})

describe('samePlace', () => {
  it('compares repo, folder, file and sheet', () => {
    expect(samePlace(repo, { ...repo, tab: 'commits', branch: 'x' })).toBe(true)
    expect(samePlace(repo, { ...repo, path: '/a' })).toBe(false)
  })
})
