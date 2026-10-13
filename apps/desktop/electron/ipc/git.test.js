// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { register, gitEnv, isRepositoryRoot } from './git.cjs'

const ROOT = process.platform === 'win32' ? 'C:\\repos' : '/repos'
const REPO = { name: 'App', path: path.join(ROOT, 'App') }
const COMMON = path.join(ROOT, 'App', '.git')

function fakeChild(result, pid) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.pid = pid
  if (result !== 'hang') {
    setImmediate(() => {
      child.stdout.end(Buffer.from(result.stdout || ''))
      child.stderr.end(Buffer.from(result.stderr || ''))
      setImmediate(() => child.emit('close', result.code ?? 0))
    })
  }
  return child
}

function setup(respond = () => ({ stdout: '' }), probe = {}, extra = {}) {
  const handlers = {}
  const calls = []
  const deps = {
    spawn: vi.fn((cmd, args, opts) => {
      calls.push({ cmd, args: args.slice(1), opts })
      return fakeChild(respond(args.slice(1), opts), 1000 + calls.length)
    }),
    kill: vi.fn(async () => {}),
    probe: { isDirectory: () => true, isFile: () => false, exists: () => false, listDirectories: () => [], readText: () => null, mtime: () => null, ...probe },
    timeoutMs: 50,
    logger: { scope: () => ({ error: () => {}, info: () => {} }) },
    ...extra,
  }
  const api = register({ handle: (channel, fn) => { handlers[channel] = fn } }, deps)
  const invoke = (channel, ...args) => handlers[channel](null, ...args)
  return { invoke, calls, deps, api }
}

const commonDirResponder = extra => (args, opts) =>
  args[0] === 'rev-parse' && args[2] === '--git-common-dir' ? { stdout: `${COMMON}\n` } : extra(args, opts)

describe('git env and repository markers', () => {
  it('disables prompts and optional locks and drops inherited git location variables', () => {
    const env = gitEnv({ PATH: 'p', GIT_DIR: 'x', GIT_WORK_TREE: 'y', GIT_INDEX_FILE: 'z', GIT_COMMON_DIR: 'c' })
    expect(env).toMatchObject({ PATH: 'p', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' })
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) expect(env[k]).toBeUndefined()
  })

  it('recognises .git, .git-main, .bare and bare repository layouts', () => {
    const at = names => ({ exists: p => names.includes(path.basename(p)), isDirectory: p => names.includes(path.basename(p)), isFile: p => names.includes(path.basename(p)) })
    expect(isRepositoryRoot(ROOT, at(['.git']))).toBe(true)
    expect(isRepositoryRoot(ROOT, at(['.git-main']))).toBe(true)
    expect(isRepositoryRoot(ROOT, at(['.bare']))).toBe(true)
    expect(isRepositoryRoot(ROOT, at(['HEAD', 'objects']))).toBe(true)
    expect(isRepositoryRoot(ROOT, at(['src']))).toBe(false)
  })
})

describe('git:worktrees and git:branches', () => {
  it('runs an exact argv in the common dir, hidden, without a shell and with prompts disabled', async () => {
    const { invoke, calls, deps } = setup(commonDirResponder(() => ({ stdout: 'worktree X\0\0' })))
    expect(await invoke('git:worktrees', REPO, [REPO.path])).toBe('worktree X\0\0')
    expect(calls.map(c => c.args)).toEqual([['rev-parse', '--path-format=absolute', '--git-common-dir'], ['worktree', 'list', '--porcelain', '-z']])
    expect(deps.spawn.mock.calls[0][0]).toBe('git')
    expect(deps.spawn.mock.calls[0][1][0]).toBe('--no-pager')
    expect(calls[1].opts).toMatchObject({ cwd: COMMON, windowsHide: true })
    expect(calls[1].opts.shell).toBeUndefined()
    expect(calls[1].opts.env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('reads branches with NUL-separated fields', async () => {
    const { invoke, calls } = setup(commonDirResponder(() => ({ stdout: 'refs/heads/main\0a\0s\0\n' })))
    expect(await invoke('git:branches', REPO, [REPO.path])).toBe('refs/heads/main\0a\0s\0\n')
    expect(calls[1].args).toEqual(['for-each-ref', '--sort=refname', '--format=%(refname)%00%(objectname)%00%(subject)%00%(upstream:short)', 'refs/heads/'])
  })

  it('rejects unregistered or relative repository paths without spawning git', async () => {
    const { invoke, deps } = setup()
    await expect(invoke('git:worktrees', { name: 'X', path: path.join(ROOT, 'Other') }, [REPO.path])).rejects.toThrow(/Not a registered repository/)
    await expect(invoke('git:branches', { name: 'X', path: 'App' }, ['App'])).rejects.toThrow(/absolute/)
    await expect(invoke('git:worktrees', REPO, 'not-a-list')).rejects.toThrow(/Not a registered repository/)
    expect(deps.spawn).not.toHaveBeenCalled()
  })
})

describe('git:status', () => {
  it('returns porcelain, the operation in progress, the rebasing branch, fetch time and the upstream check', async () => {
    const gitDir = path.join(COMMON, 'worktrees', 'feature')
    const { invoke, calls } = setup((args) => {
      if (args[0] === 'status') return { stdout: '# branch.head x\0' }
      if (args[2] === '--git-dir') return { stdout: `${gitDir}\n` }
      if (args[2] === '--git-common-dir') return { stdout: `${COMMON}\n` }
      if (args[1] === '--verify') return { code: 1 }
      return { stdout: '' }
    }, {
      exists: p => p === path.join(gitDir, 'rebase-merge'),
      readText: p => p === path.join(gitDir, 'rebase-merge', 'head-name') ? 'refs/heads/feature\n' : null,
      mtime: p => p === path.join(COMMON, 'FETCH_HEAD') ? '2026-10-13T08:00:00.000Z' : null,
    })
    const result = await invoke('git:status', REPO, path.join(REPO.path, 'feature'), [REPO.path])
    expect(result).toEqual({ porcelain: '# branch.head x\0', operation: 'Rebase in progress', rebasingBranch: 'refs/heads/feature', fetchedAt: '2026-10-13T08:00:00.000Z', upstreamResolves: false })
    expect(calls[0].args).toEqual(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
    expect(calls[0].opts.cwd).toBe(path.join(REPO.path, 'feature'))
  })

  it('rejects a worktree outside the repo that git does not list, without running git status', async () => {
    const { invoke, calls } = setup(commonDirResponder(() => ({ stdout: `worktree ${REPO.path}\0\0` })))
    await expect(invoke('git:status', REPO, path.join(ROOT, 'Elsewhere'), [REPO.path])).rejects.toThrow(/Not a worktree of/)
    expect(calls.some(c => c.args[0] === 'status')).toBe(false)
  })

  it('accepts an external worktree that git lists', async () => {
    const external = path.join(ROOT, 'external topic')
    const { invoke } = setup(commonDirResponder(args => args[0] === 'worktree' ? { stdout: `worktree ${REPO.path}\0\0worktree ${external}\0\0` } : { stdout: '' }))
    expect(await invoke('git:status', REPO, external, [REPO.path])).toMatchObject({ porcelain: '' })
  })

  it('reports a missing worktree folder without running git status', async () => {
    const { invoke, calls } = setup(() => ({ stdout: '' }), { isDirectory: p => !p.endsWith('gone') })
    expect(await invoke('git:status', REPO, path.join(REPO.path, 'gone'), [REPO.path])).toEqual({ missing: true })
    expect(calls).toHaveLength(0)
  })

  it('returns a git failure as an error field', async () => {
    const { invoke } = setup(args => args[0] === 'status' ? { code: 128, stderr: 'fatal: index.lock exists\n' } : { stdout: '' })
    expect(await invoke('git:status', REPO, REPO.path, [REPO.path])).toEqual({ error: 'fatal: index.lock exists' })
  })

  it('kills the process tree and rejects when git exceeds the timeout', async () => {
    const { invoke, deps } = setup(() => 'hang')
    await expect(invoke('git:status', REPO, REPO.path, [REPO.path])).rejects.toThrow(/timed out/)
    expect(deps.kill).toHaveBeenCalledWith(1001)
  })
})

describe('git:discover and git:checkFolders', () => {
  it('lists repo folders one level down, skips plain folders and missing roots, de-duplicates and marks registered ones', async () => {
    const commonFor = cwd => cwd.includes('b-repo') || cwd === REPO.path ? path.join(ROOT, 'B', '.git') : path.join(ROOT, 'A', '.git')
    const { invoke } = setup(
      (args, opts) => args[0] === 'rev-parse' ? { stdout: `${commonFor(opts.cwd)}\n` } : { stdout: '' },
      {
        isDirectory: p => !p.endsWith('missing'),
        listDirectories: () => ['b-repo', 'A-repo', 'plain', 'dup'],
        exists: p => ['A-repo', 'b-repo', 'dup'].some(n => p === path.join(ROOT, n, '.git')),
      })
    const found = await invoke('git:discover', [ROOT, path.join(ROOT, 'missing'), 'relative'], [REPO])
    expect(found.map(f => f.name)).toEqual(['A-repo', 'b-repo'])
    expect(found[1]).toMatchObject({ registeredAs: 'App', commonDir: path.join(ROOT, 'B', '.git') })
    expect(found[0].registeredAs).toBeNull()
    expect(found[0].path).toBe(path.join(ROOT, 'A-repo').replace(/\\/g, '/'))
  })

  it('reports which folders exist, accepting only absolute paths', async () => {
    const { invoke } = setup(() => ({ stdout: '' }), { isDirectory: p => p === ROOT })
    expect(await invoke('git:checkFolders', [ROOT, path.join(ROOT, 'nope'), 'rel'])).toEqual([
      { path: ROOT, exists: true }, { path: path.join(ROOT, 'nope'), exists: false }, { path: 'rel', exists: false },
    ])
  })
})

describe('process limits', () => {
  it('runs at most maxConcurrent git processes and kills running ones on dispose', async () => {
    let live = 0, peak = 0
    const { invoke, deps, api } = setup(() => 'hang', {}, { timeoutMs: 10000, maxConcurrent: 2 })
    deps.spawn.mockImplementation(() => { live++; peak = Math.max(peak, live); return fakeChild('hang', 7) })
    for (let i = 0; i < 4; i++) invoke('git:version').catch(() => {})
    await new Promise(r => setImmediate(r))
    expect(peak).toBe(2)
    await api.disposeAll()
    expect(deps.kill).toHaveBeenCalled()
  })
})
