import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getGitConfig, setGitConfig, DEFAULT_GIT_CONFIG, effectiveRoots, parseRoots, GIT_CONFIG_EVENT } from './git-config.js'
import { getProfileKey } from './profile-keys.js'

describe('git config', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty with the default search root', () => {
    expect(getGitConfig()).toEqual(DEFAULT_GIT_CONFIG)
    expect(effectiveRoots(getGitConfig())).toEqual(['C:/repos'])
    expect(effectiveRoots({ roots: [] })).toEqual([])
  })

  it('merges and persists patches and announces the change', () => {
    const seen = vi.fn()
    window.addEventListener(GIT_CONFIG_EVENT, seen)
    setGitConfig({ repos: [{ name: 'A', path: 'C:/repos/A' }] })
    expect(getGitConfig().repos).toEqual([{ name: 'A', path: 'C:/repos/A' }])
    expect(seen).toHaveBeenCalled()
    window.removeEventListener(GIT_CONFIG_EVENT, seen)
  })

  it('fills in missing fields of older or partial settings', () => {
    localStorage.setItem(getProfileKey('git.config'), JSON.stringify({
      repos: [{ name: 'A', path: 'C:/repos/A' }, { name: 'bad' }], groups: [{ name: 'G', repos: ['A'] }, { nope: 1 }], extra: true,
    }))
    const cfg = getGitConfig()
    expect(cfg.repos).toEqual([{ name: 'A', path: 'C:/repos/A' }])
    expect(cfg.groups).toEqual([{ name: 'G', repos: ['A'], worktrees: [], branches: [] }])
    expect(cfg.roots).toBeNull()
    expect(cfg.view).toEqual(DEFAULT_GIT_CONFIG.view)
    expect(cfg.extra).toBeUndefined()
  })

  it('marks settings from a newer version as unsupported and survives corrupt storage', () => {
    localStorage.setItem(getProfileKey('git.config'), JSON.stringify({ version: 2 }))
    expect(getGitConfig().unsupported).toBe(2)
    localStorage.setItem(getProfileKey('git.config'), '{nope')
    expect(getGitConfig()).toEqual(DEFAULT_GIT_CONFIG)
    expect(getGitConfig().repos).not.toBe(DEFAULT_GIT_CONFIG.repos)
  })

  it('does not overwrite settings from a newer version on save', () => {
    const raw = JSON.stringify({ version: 2, repos: [{ name: 'X', path: 'C:/x' }] })
    localStorage.setItem(getProfileKey('git.config'), raw)
    const seen = vi.fn()
    window.addEventListener(GIT_CONFIG_EVENT, seen)
    expect(setGitConfig({ repos: [] }).unsupported).toBe(2)
    expect(localStorage.getItem(getProfileKey('git.config'))).toBe(raw)
    expect(seen).not.toHaveBeenCalled()
    window.removeEventListener(GIT_CONFIG_EVENT, seen)
  })

  it('returns fresh arrays so callers cannot corrupt the defaults', () => {
    const cfg = getGitConfig()
    expect(cfg.repos).not.toBe(DEFAULT_GIT_CONFIG.repos)
    expect(cfg.groups).not.toBe(DEFAULT_GIT_CONFIG.groups)
    cfg.repos.push({ name: 'Z', path: 'C:/z' })
    expect(DEFAULT_GIT_CONFIG.repos).toEqual([])
  })

  it('parses semicolon-separated absolute search roots', () => {
    expect(parseRoots(' C:/repos ; ;D:\\src; repos ')).toEqual({ roots: ['C:/repos', 'D:\\src'], invalid: ['repos'], network: [] })
    expect(parseRoots('C:/repos;c:/REPOS').roots).toEqual(['C:/repos'])
    expect(parseRoots('')).toEqual({ roots: [], invalid: [], network: [] })
  })

  it('reports UNC and device roots as network paths, not as roots', () => {
    expect(parseRoots('\\\\server\\share;//server/share;\\\\?\\C:\\repo;C:/repos')).toEqual({
      roots: ['C:/repos'], invalid: [], network: ['\\\\server\\share', '//server/share', '\\\\?\\C:\\repo'],
    })
  })
})
