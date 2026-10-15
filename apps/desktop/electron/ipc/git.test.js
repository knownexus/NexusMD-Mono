// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { parseDiff } from '@nexusmd/core'
import { register, gitEnv, isRepositoryRoot, findGit, extractHunk, logArgs, HISTORY_CONFIG } from './git.cjs'

const ROOT = process.platform === 'win32' ? 'C:\\repos' : '/repos'
const REPO = { name: 'App', path: path.join(ROOT, 'App') }
const COMMON = path.join(ROOT, 'App', '.git')
const GIT = path.join(ROOT, 'Git', 'cmd', 'git.exe')
const FSMON = ['-c', 'core.fsmonitor=false']

function fakeChild(result, pid) {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.pid = pid
  child.stdin = new PassThrough()
  child.input = ''
  child.inputBytes = []
  child.stdin.on('data', c => { child.input += c; child.inputBytes.push(Buffer.from(c)) })
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
      const op = args.slice(1 + FSMON.length)
      const call = { cmd, args: op, raw: args, opts }
      calls.push(call)
      call.child = fakeChild(respond(op, opts), 1000 + calls.length)
      return call.child
    }),
    kill: vi.fn(async () => {}),
    probe: {
      isDirectory: () => true, isFile: () => false, exists: () => false, listDirectories: () => [], readText: () => null, mtime: () => null,
      isLink: () => false, size: () => null, readBytes: () => null, statKey: () => '', unlink: vi.fn(), ...probe,
    },
    gitPath: GIT,
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

describe('findGit', () => {
  const win = process.platform === 'win32'
  const A = path.join(ROOT, 'a')
  const B = path.join(ROOT, 'b')
  const env = { PATH: ['', 'relative', A, B].join(path.delimiter) }
  const exe = win ? 'git.exe' : 'git'

  it('strips surrounding double quotes from PATH entries', () => {
    const quoted = { PATH: [`"${A}"`, B].join(path.delimiter) }
    expect(findGit(quoted, { isFile: p => p === path.join(A, exe) })).toBe(path.join(A, exe))
  })

  it('ignores empty and relative PATH entries and takes the first existing file', () => {
    const seen = []
    const found = findGit(env, { isFile: p => { seen.push(p); return p === path.join(B, exe) } })
    expect(found).toBe(path.join(B, exe))
    expect(seen.every(p => path.isAbsolute(p))).toBe(true)
  })

  it.runIf(win)('tries git.exe before git.com in each directory', () => {
    expect(findGit(env, { isFile: p => p.startsWith(A) })).toBe(path.join(A, 'git.exe'))
    expect(findGit(env, { isFile: p => p === path.join(A, 'git.com') })).toBe(path.join(A, 'git.com'))
  })

  it('returns null when git is not on PATH', () => {
    expect(findGit(env, { isFile: () => false })).toBeNull()
  })
})

describe('git not found', () => {
  it('reports no version and rejects other operations', async () => {
    const { invoke, deps } = setup(() => ({ stdout: '' }), {}, { gitPath: null })
    expect(await invoke('git:version')).toBeNull()
    await expect(invoke('git:resolve', ROOT)).rejects.toThrow(/Git not found/)
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('looks for git again, so installing it and reopening the screen works', async () => {
    let installed = false
    const exe = process.platform === 'win32' ? 'git.exe' : 'git'
    const { invoke, calls } = setup(() => ({ stdout: 'git version 2.50.0\n' }), { isFile: p => installed && p === path.join(ROOT, exe) }, { gitPath: undefined, env: { PATH: ROOT } })
    expect(await invoke('git:version')).toBeNull()
    installed = true
    expect(await invoke('git:version')).toBe('git version 2.50.0')
    expect(calls[0].cmd).toBe(path.join(ROOT, exe))
  })
})

describe('git:worktrees and git:branches', () => {
  it('runs an exact argv in the common dir, hidden, without a shell and with prompts disabled', async () => {
    const { invoke, calls, deps } = setup(commonDirResponder(() => ({ stdout: 'worktree X\0\0' })))
    expect(await invoke('git:worktrees', REPO, [REPO.path])).toBe('worktree X\0\0')
    expect(calls.map(c => c.args)).toEqual([['rev-parse', '--path-format=absolute', '--git-common-dir'], ['worktree', 'list', '--porcelain', '-z']])
    expect(deps.spawn.mock.calls[0][0]).toBe(GIT)
    for (const c of calls) expect(c.raw.slice(0, 3)).toEqual(['--no-pager', ...FSMON])
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

  it('resolves the common dir once per repo within the cache window', async () => {
    let t = 0
    const { invoke, calls, api } = setup(commonDirResponder(() => ({ stdout: '' })), {}, { now: () => t })
    await invoke('git:worktrees', REPO, [REPO.path])
    await invoke('git:branches', REPO, [REPO.path])
    t = 4999
    await invoke('git:worktrees', REPO, [REPO.path])
    expect(calls.filter(c => c.args[0] === 'rev-parse')).toHaveLength(1)
    t = 5000
    await invoke('git:worktrees', REPO, [REPO.path])
    expect(calls.filter(c => c.args[0] === 'rev-parse')).toHaveLength(2)
    expect(api.cacheSize()).toBe(1)
    await api.disposeAll()
    expect(api.cacheSize()).toBe(0)
  })

  it('tries .git-main and .bare first when the folder has no .git', async () => {
    const { invoke, calls } = setup(() => ({ stdout: `${COMMON}\n` }), { exists: () => false, isDirectory: p => !p.endsWith('.bare') })
    await invoke('git:resolve', REPO.path)
    expect(calls.map(c => c.opts.cwd)).toEqual([path.join(REPO.path, '.git-main')])
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
  it('returns porcelain, the operation in progress, the rebasing branch and fetch time from two git processes', async () => {
    const gitDir = path.join(COMMON, 'worktrees', 'feature')
    const { invoke, calls } = setup((args) => {
      if (args[0] === 'status') return { stdout: '# branch.head x\0' }
      if (args[0] === 'rev-parse') return { stdout: `${gitDir}\n${COMMON}\n` }
      return { stdout: '' }
    }, {
      exists: p => p === path.join(gitDir, 'rebase-merge'),
      readText: p => p === path.join(gitDir, 'rebase-merge', 'head-name') ? 'refs/heads/feature\n' : null,
      mtime: p => p === path.join(COMMON, 'FETCH_HEAD') ? '2026-10-13T08:00:00.000Z' : null,
    })
    const result = await invoke('git:status', REPO, path.join(REPO.path, 'feature'), [REPO.path])
    expect(result).toEqual({ porcelain: '# branch.head x\0', operation: 'Rebase in progress', rebasingBranch: 'refs/heads/feature', fetchedAt: '2026-10-13T08:00:00.000Z' })
    expect(calls.map(c => c.args)).toEqual([
      ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'],
      ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
    ])
    expect(calls.some(c => c.args.includes('@{upstream}'))).toBe(false)
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

describe('remote and device paths', () => {
  const bad = ['\\\\server\\share\\repo', '\\\\?\\C:\\repo', '//server/share/repo']

  it('rejects them as repository, folder and worktree paths without spawning git', async () => {
    const { invoke, deps } = setup()
    for (const p of bad) {
      await expect(invoke('git:resolve', p)).rejects.toThrow("Network (UNC) paths aren't supported")
      await expect(invoke('git:worktrees', { name: 'X', path: p }, [p])).rejects.toThrow("Network (UNC) paths aren't supported")
    }
    expect(deps.spawn).not.toHaveBeenCalled()
  })

  it('still says "must be an absolute path" for relative folders', async () => {
    const { invoke } = setup()
    await expect(invoke('git:resolve', 'relative\\repo')).rejects.toThrow(/must be an absolute path/)
  })

  it('skips folders whose .git file points at a network path', async () => {
    const dotGit = name => path.join(ROOT, name, '.git')
    const { invoke, calls } = setup(() => ({ stdout: `${COMMON}\n` }), {
      listDirectories: () => ['remote', 'local'],
      exists: p => p === dotGit('remote') || p === dotGit('local'),
      isFile: p => p === dotGit('remote') || p === dotGit('local'),
      readText: p => p === dotGit('remote') ? 'gitdir: \\\\server\\share\\repo.git\n' : p === dotGit('local') ? `gitdir: ${COMMON}\n` : null,
    })
    expect((await invoke('git:discover', [ROOT], [])).map(f => f.name)).toEqual(['local'])
    expect(calls.every(c => !c.opts.cwd.includes('remote'))).toBe(true)
    await expect(invoke('git:resolve', path.join(ROOT, 'remote'))).rejects.toThrow("Network (UNC) paths aren't supported")
  })

  it('skips them in discover roots and reports them missing in checkFolders', async () => {
    const { invoke, deps } = setup()
    expect(await invoke('git:discover', bad, [])).toEqual([])
    expect(await invoke('git:checkFolders', bad)).toEqual(bad.map(p => ({ path: p, exists: false })))
    expect(deps.spawn).not.toHaveBeenCalled()
  })
})

describe('git:discover and git:checkFolders', () => {
  it('lists repo folders one level down, skips plain folders and missing roots, de-duplicates and marks registered ones', async () => {
    const commonFor = cwd => cwd.includes('b-repo') || cwd.startsWith(REPO.path) ? path.join(ROOT, 'B', '.git') : path.join(ROOT, 'A', '.git')
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
    const results = []
    for (let i = 0; i < 4; i++) results.push(invoke('git:resolve', ROOT).catch(e => e))
    await new Promise(r => setImmediate(r))
    expect(peak).toBe(2)
    await api.disposeAll()
    expect(deps.kill).toHaveBeenCalled()
    const settled = await Promise.all(results.slice(2))
    expect(settled.every(e => /shutting down/.test(e.message))).toBe(true)
    await expect(invoke('git:resolve', ROOT)).rejects.toThrow(/shutting down/)
    expect(deps.spawn).toHaveBeenCalledTimes(2)
  })
})

const WT = REPO.path
const REG = [REPO.path]
const HEAD = 'a'.repeat(40)
const LS = '100644 1111111111111111111111111111111111111111 0\ta b.txt\x00100644 2222222222222222222222222222222222222222 0\tother.txt\x00'
const STATUS = '1 .M N... 100644 100644 100644 1111111111111111111111111111111111111111 1111111111111111111111111111111111111111 a b.txt\x00? new.txt\x00'
const DIFF_ARGS = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-U3']
// Answers the read commands stage 2 runs; `over` replaces answers by subcommand.
const reads = (over = {}) => args => {
  if (args[0] in over) return typeof over[args[0]] === 'function' ? over[args[0]](args) : over[args[0]]
  if (args[0] === 'rev-parse' && args.includes('HEAD')) return { stdout: `${HEAD}\n` }
  if (args[0] === 'rev-parse' && args[2] === '--git-common-dir') return { stdout: `${COMMON}\n` }
  if (args[0] === 'worktree') return { stdout: `worktree ${WT.replace(/\\/g, '/')}\0HEAD ${HEAD}\0branch refs/heads/main\0\0` }
  if (args[0] === 'ls-files') return { stdout: LS }
  if (args[0] === 'status') return { stdout: STATUS }
  if (args[0] === 'diff') return { stdout: 'diff --git a/a b.txt b/a b.txt\n' }
  return { stdout: '' }
}
const unstaged = (paths = ['a b.txt']) => ({ area: 'unstaged', paths })

describe('stage 2 reads', () => {
  it('sets literal pathspecs unless a call opts out', () => {
    expect(gitEnv({}).GIT_LITERAL_PATHSPECS).toBe('1')
    expect(gitEnv({}, { literal: false }).GIT_LITERAL_PATHSPECS).toBeUndefined()
    expect('GIT_LITERAL_PATHSPECS' in gitEnv({ GIT_LITERAL_PATHSPECS: '1' }, { literal: false })).toBe(false)
  })

  it('rejects a folder inside the repo that git does not list as a worktree, without spawning a read or write', async () => {
    const sub = path.join(WT, 'sub')
    const requests = [
      ['git:diff', unstaged()], ['git:stamp', { kind: 'files', paths: ['a b.txt'] }], ['git:stage', ['a b.txt'], 'x'],
      ['git:discard', ['a b.txt'], 'x'], ['git:deleteUntracked', ['a b.txt'], 'x'], ['git:commit', 'Fix', 'x'],
      ['git:stageHunk', ['a b.txt'], 0, 'x'], ['git:unstageHunk', ['a b.txt'], 0, 'x'],
    ]
    for (const [channel, ...args] of requests) {
      const s = setup(reads())
      await expect(s.invoke(channel, REPO, sub, REG, ...args)).rejects.toThrow(`Not a worktree of ${REPO.path}: ${sub}`)
      expect(s.calls.map(c => c.args[0])).toEqual(['rev-parse', 'worktree'])
    }
  })

  it('still lets status read any folder inside the repo', async () => {
    const s = setup(reads())
    expect(await s.invoke('git:status', REPO, path.join(WT, 'sub'), REG)).toMatchObject({ porcelain: STATUS })
    expect(s.calls.some(c => c.args[0] === 'worktree')).toBe(false)
  })

  it('diffs unstaged and staged changes with an exact argv', async () => {
    const a = setup(reads())
    await a.invoke('git:diff', REPO, WT, REG, unstaged())
    expect(a.calls.find(c => c.args[0] === 'diff').args).toEqual([...DIFF_ARGS, '--', 'a b.txt'])
    const b = setup(reads())
    await b.invoke('git:diff', REPO, WT, REG, { area: 'staged', paths: ['moved.txt', 'was.txt'] })
    expect(b.calls.find(c => c.args[0] === 'diff').args).toEqual([...DIFF_ARGS, '--cached', '--', 'moved.txt', 'was.txt'])
    const c = setup(reads())
    await c.invoke('git:diff', REPO, WT, REG, { area: 'conflict', paths: ['both.txt'] })
    expect(c.calls.find(x => x.args[0] === 'diff').args).toEqual([...DIFF_ARGS, '--', 'both.txt'])
  })

  it('returns the diff with a stamp that follows the diff text', async () => {
    const run = text => setup(reads({ diff: { stdout: text } })).invoke('git:diff', REPO, WT, REG, unstaged())
    const a = await run('one')
    expect([a.text, a.truncated, a.binary, a.size]).toEqual(['one', false, false, 3])
    expect(a.stamp).toMatch(/^[0-9a-f]{64}$/)
    expect((await run('one')).stamp).toBe(a.stamp)
    expect((await run('two')).stamp).not.toBe(a.stamp)
  })

  it('flags binary diffs and truncates diffs over 1 MB', async () => {
    const bin = await setup(reads({ diff: { stdout: 'diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n' } }))
      .invoke('git:diff', REPO, WT, REG, unstaged(['x.png']))
    expect(bin.binary).toBe(true)
    const big = await setup(reads({ diff: { stdout: 'x'.repeat(1024 * 1024 + 10) } })).invoke('git:diff', REPO, WT, REG, unstaged())
    expect([big.truncated, big.text.length, big.size]).toEqual([true, 1024 * 1024, 1024 * 1024 + 10])
  })

  it('builds untracked diffs from the file itself without running git diff', async () => {
    const { invoke, calls } = setup(reads(), { size: () => 9, readBytes: () => Buffer.from('one\r\ntwo\n') })
    const d = await invoke('git:diff', REPO, WT, REG, { area: 'untracked', paths: ['new.txt'] })
    expect(d.text).toBe('--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n')
    expect(calls.some(c => c.args[0] === 'diff')).toBe(false)
  })

  it('reports binary, oversized, empty, vanished and linked untracked files', async () => {
    const untracked = probe => setup(reads(), probe).invoke('git:diff', REPO, WT, REG, { area: 'untracked', paths: ['new.txt'] })
    const bin = await untracked({ size: () => 3, readBytes: () => Buffer.from([1, 0, 2]) })
    expect([bin.binary, bin.text]).toEqual([true, ''])
    const big = await untracked({ size: () => 2 * 1024 * 1024 })
    expect([big.truncated, big.size, big.text]).toEqual([true, 2 * 1024 * 1024, ''])
    const empty = await untracked({ size: () => 0, readBytes: () => Buffer.alloc(0) })
    expect([empty.text, empty.size]).toEqual(['', 0])
    expect((await untracked({ size: () => null })).gone).toBe(true)
    await expect(untracked({ isLink: () => true })).rejects.toThrow('Refusing to read a linked file: new.txt')
  })

  it('stamps only the requested paths for file actions, and the whole index for commits', async () => {
    const stamp = (over, request = { kind: 'files', paths: ['a b.txt'] }) => setup(reads(over)).invoke('git:stamp', REPO, WT, REG, request)
    const base = await stamp({})
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    const other = '1 .M N... 100644 100644 100644 3333333333333333333333333333333333333333 3333333333333333333333333333333333333333 other.txt\x00'
    expect(await stamp({ status: { stdout: STATUS + other } })).toBe(base)
    expect(await stamp({ 'ls-files': { stdout: LS.replace('1111111111111111111111111111111111111111', '9'.repeat(40)) } })).not.toBe(base)
    expect(await stamp({ status: { stdout: STATUS.replace('.M', 'MM') } })).not.toBe(base)
    const commit = await stamp({}, { kind: 'commit' })
    expect(await stamp({ 'ls-files': { stdout: LS.replace('2222222222222222222222222222222222222222', '8'.repeat(40)) } }, { kind: 'commit' })).not.toBe(commit)
  })

  it('rejects bad file paths, unknown areas and unregistered repos without spawning git', async () => {
    for (const bad of [['../x'], ['C:\\x'], ['C:x'], ['/x'], [], ['a\x00b'], [42]]) {
      const { invoke, deps } = setup(reads())
      await expect(invoke('git:diff', REPO, WT, REG, unstaged(bad))).rejects.toThrow()
      expect(deps.spawn).not.toHaveBeenCalled()
    }
    await expect(setup(reads()).invoke('git:diff', REPO, WT, REG, { area: 'weird', paths: ['a'] })).rejects.toThrow('Unknown change area: weird')
    await expect(setup(reads()).invoke('git:diff', REPO, WT, [], unstaged())).rejects.toThrow('Not a registered repository')
    await expect(setup(reads()).invoke('git:stamp', REPO, WT, REG, { kind: 'other' })).rejects.toThrow('Unknown stamp request')
  })
})

const stampOf = async (s, request) => s.invoke('git:stamp', REPO, WT, REG, request)
const files = (paths = ['a b.txt']) => ({ kind: 'files', paths })

describe('stage 2 writes', () => {
  it('stages paths through stdin after checking the stamp', async () => {
    const s = setup(reads())
    const expected = await stampOf(s, files(['a b.txt', '-x [1].txt']))
    const r = await s.invoke('git:stage', REPO, WT, REG, ['a b.txt', '-x [1].txt'], expected)
    expect(r).toEqual({ ok: true, detail: 'Done' })
    const add = s.calls.find(c => c.args[0] === 'add')
    expect(add.args).toEqual(['add', '--pathspec-from-file=-', '--pathspec-file-nul'])
    expect(add.opts.stdio[0]).toBe('pipe')
    expect(add.child.input).toBe('a b.txt\x00-x [1].txt\x00')
  })

  it('refuses a stale review without running the write', async () => {
    const s = setup(reads())
    const r = await s.invoke('git:stage', REPO, WT, REG, ['a b.txt'], 'not-the-stamp')
    expect(r).toEqual({ ok: false, stale: true, detail: 'Changed since you reviewed it. Refresh and review again.' })
    expect(s.calls.some(c => c.args[0] === 'add')).toBe(false)
  })

  it('refuses submodule paths', async () => {
    const s = setup(reads({ 'ls-files': { stdout: '160000 3333333333333333333333333333333333333333 0\tlib\x00' } }))
    const r = await s.invoke('git:stage', REPO, WT, REG, ['lib'], await stampOf(s, files(['lib'])))
    expect(r).toEqual({ ok: false, detail: 'Submodule changes need to be managed inside the submodule.' })
    expect(s.calls.some(c => c.args[0] === 'add')).toBe(false)
  })

  it('unstages with restore --staged, or rm --cached on an unborn branch', async () => {
    const s = setup(reads())
    await s.invoke('git:unstage', REPO, WT, REG, ['a b.txt'], await stampOf(s, files()))
    expect(s.calls.find(c => c.args[0] === 'restore').args).toEqual(['restore', '--staged', '--pathspec-from-file=-', '--pathspec-file-nul'])
    const u = setup(reads({ 'rev-parse': args => (args.includes('HEAD') ? { code: 1 } : { stdout: `${COMMON}\n` }) }))
    await u.invoke('git:unstage', REPO, WT, REG, ['a b.txt'], await stampOf(u, files()))
    expect(u.calls.find(c => c.args[0] === 'rm').args).toEqual(['rm', '--cached', '-r', '--ignore-unmatch', '--quiet', '--pathspec-from-file=-', '--pathspec-file-nul'])
  })

  it('discards only tracked files with unstaged changes', async () => {
    const s = setup(reads())
    expect(await s.invoke('git:discard', REPO, WT, REG, ['a b.txt'], await stampOf(s, files()))).toEqual({ ok: true, detail: 'Done' })
    expect(s.calls.find(c => c.args[0] === 'restore').args).toEqual(['restore', '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'])
    const t = setup(reads())
    const r = await t.invoke('git:discard', REPO, WT, REG, ['new.txt'], await stampOf(t, files(['new.txt'])))
    expect(r).toEqual({ ok: false, detail: 'Discard only accepts tracked files with unstaged changes: new.txt' })
    expect(t.calls.some(c => c.args[0] === 'restore')).toBe(false)
  })

  it('returns git failures with output, adding a hint for a held index lock', async () => {
    const s = setup(reads({ add: { code: 128, stderr: "fatal: Unable to create 'C:/repos/App/.git/index.lock': File exists." } }))
    const r = await s.invoke('git:stage', REPO, WT, REG, ['a b.txt'], await stampOf(s, files()))
    expect(r.ok).toBe(false)
    expect(r.detail).toBe("fatal: Unable to create 'C:/repos/App/.git/index.lock': File exists.\nAnother git process is using this repo; close it or remove the stale lock.")
  })

  it('commits the message through stdin with the longer timeout', async () => {
    const s = setup(reads({ diff: { code: 1 }, commit: { stdout: '[main abc1234] Fix it\n' } }))
    const r = await s.invoke('git:commit', REPO, WT, REG, 'Fix it\n\nBody', await stampOf(s, { kind: 'commit' }))
    expect(r).toEqual({ ok: true, detail: '[main abc1234] Fix it' })
    const commit = s.calls.find(c => c.args[0] === 'commit')
    expect(commit.args).toEqual(['commit', '-F', '-'])
    expect(commit.child.input).toBe('Fix it\n\nBody')
    expect(s.calls.find(c => c.args[0] === 'diff').args).toEqual(['diff', '--cached', '--quiet', '--no-ext-diff'])
  })

  it('runs the commit (and so its hooks) without literal pathspecs, while path-taking calls keep them', async () => {
    const s = setup(reads({ diff: { code: 1 } }))
    await s.invoke('git:commit', REPO, WT, REG, 'Fix', await stampOf(s, { kind: 'commit' }))
    const commit = s.calls.find(c => c.args[0] === 'commit')
    expect(commit.opts.env.GIT_LITERAL_PATHSPECS).toBeUndefined()
    expect(commit.opts.env.GIT_TERMINAL_PROMPT).toBe('0')
    for (const c of s.calls.filter(x => x.args[0] !== 'commit')) expect(c.opts.env.GIT_LITERAL_PATHSPECS).toBe('1')
    const t = setup(reads())
    await t.invoke('git:stage', REPO, WT, REG, ['a b.txt'], await stampOf(t, files()))
    expect(t.calls.find(c => c.args[0] === 'add').opts.env.GIT_LITERAL_PATHSPECS).toBe('1')
  })

  it('refuses to stage an untracked nested repository, by its folder record, bare name or a path inside it', async () => {
    const status = { status: { stdout: `${STATUS}? nested/\x00` } }
    for (const p of ['nested/', 'nested', 'nested/x.txt']) {
      const s = setup(reads(status))
      const r = await s.invoke('git:stage', REPO, WT, REG, ['a b.txt', p], await stampOf(s, files(['a b.txt', p])))
      expect(r).toEqual({ ok: false, detail: 'Nested repositories are managed on their own.' })
      expect(s.calls.some(c => c.args[0] === 'add')).toBe(false)
    }
  })

  it('covers each path\'s size and mtime in the files stamp, so a later edit is stale and nothing is restored', async () => {
    let key = '10:1000'
    const s = setup(reads(), { statKey: p => (p === path.join(WT, 'a b.txt') ? key : '') })
    const expected = await stampOf(s, files())
    expect(await stampOf(s, files())).toBe(expected)
    key = '11:2000'
    const r = await s.invoke('git:discard', REPO, WT, REG, ['a b.txt'], expected)
    expect(r).toEqual({ ok: false, stale: true, detail: 'Changed since you reviewed it. Refresh and review again.' })
    expect(s.calls.some(c => c.args[0] === 'restore')).toBe(false)
  })

  it('refuses empty messages, nothing staged, conflicts and operations in progress', async () => {
    const commit = async (over, message = 'Fix', probe = {}) => {
      const s = setup(reads(over), probe)
      const r = await s.invoke('git:commit', REPO, WT, REG, message, await stampOf(s, { kind: 'commit' }))
      return [r, s.calls.some(c => c.args[0] === 'commit')]
    }
    expect(await commit({ diff: { code: 1 } }, '  ')).toEqual([{ ok: false, detail: 'Enter a commit message.' }, false])
    expect(await commit({ diff: { code: 0 } })).toEqual([{ ok: false, detail: 'No staged changes.' }, false])
    expect(await commit({ diff: { code: 1 }, 'ls-files': { stdout: '100644 1111111111111111111111111111111111111111 1\tboth.txt\x00' } }))
      .toEqual([{ ok: false, detail: 'Resolve conflicts before committing.' }, false])
    const merging = await commit(
      { diff: { code: 1 }, 'rev-parse': args => args.includes('HEAD') ? { stdout: `${HEAD}\n` } : { stdout: `${COMMON}\n${COMMON}\n` } },
      'Fix', { exists: p => p === path.join(COMMON, 'MERGE_HEAD') })
    expect(merging).toEqual([{ ok: false, detail: 'Merge in progress. Continue or abort it first.' }, false])
  })

  it('reports a commit that outlives its timeout', async () => {
    const s = setup(reads({ diff: { code: 1 }, commit: 'hang' }), {}, { commitTimeoutMs: 30 })
    const r = await s.invoke('git:commit', REPO, WT, REG, 'Fix', await stampOf(s, { kind: 'commit' }))
    expect(r).toEqual({ ok: false, detail: 'git commit timed out after 0s. Hooks may have left partial output in the worktree.' })
    expect(s.deps.kill).toHaveBeenCalled()
  })

  it('runs one write at a time per repository while reads carry on', async () => {
    const s = setup(reads({ add: 'hang' }), {}, { timeoutMs: 5000 })
    const expected = await stampOf(s, files())
    const first = s.invoke('git:stage', REPO, WT, REG, ['a b.txt'], expected)
    await vi.waitFor(() => expect(s.calls.filter(c => c.args[0] === 'add')).toHaveLength(1))
    const second = s.invoke('git:stage', REPO, WT, REG, ['a b.txt'], expected)
    await s.invoke('git:diff', REPO, WT, REG, unstaged())
    await new Promise(r => setTimeout(r, 20))
    expect(s.calls.filter(c => c.args[0] === 'add')).toHaveLength(1)
    s.calls.find(c => c.args[0] === 'add').child.emit('close', 0)
    expect((await first).ok).toBe(true)
    await vi.waitFor(() => expect(s.calls.filter(c => c.args[0] === 'add')).toHaveLength(2))
    s.calls.filter(c => c.args[0] === 'add')[1].child.emit('close', 0)
    expect((await second).ok).toBe(true)
  })
})

const THREE = fs.readFileSync(new URL('../../../../packages/core/src/modules/git/fixtures/three-hunks.diff', import.meta.url), 'utf8')

describe('extractHunk', () => {
  it('keeps the file header and the chosen hunk, numbered as core numbers them', () => {
    const patch = extractHunk(THREE, 1)
    const lines = patch.split('\n')
    expect(lines.slice(0, 4)).toEqual(['diff --git a/src/app.js b/src/app.js', 'index 1111111..2222222 100644', '--- a/src/app.js', '+++ b/src/app.js'])
    expect(lines[4]).toBe(parseDiff(THREE).files[0].hunks[1].header)
    expect(lines.slice(5)).toEqual([' ten', '+ten and a half', ' eleven', ''])
    expect(extractHunk(THREE, 2).split('\n')[4]).toBe(parseDiff(THREE).files[0].hunks[2].header)
  })

  it('preserves CRLF content lines', () => {
    expect(extractHunk(THREE.replace(/\n/g, '\r\n'), 0)).toContain('-two\r\n+TWO\r\n')
  })

  it('refuses a missing hunk or a diff with more than one file', () => {
    expect(() => extractHunk(THREE, 3)).toThrow('That hunk no longer exists. Refresh and review again.')
    expect(() => extractHunk(THREE, -1)).toThrow('That hunk no longer exists. Refresh and review again.')
    expect(() => extractHunk(THREE + THREE, 0)).toThrow('This diff covers more than one file. Stage the whole file instead.')
  })
})

describe('git:stageHunk and git:unstageHunk', () => {
  const hunkSetup = (over = {}) => setup(reads({ diff: { stdout: THREE }, ...over }))
  const diffStamp = async (s, area = 'unstaged') => (await s.invoke('git:diff', REPO, WT, REG, { area, paths: ['a b.txt'] })).stamp

  it('applies one hunk to the index from stdin', async () => {
    const s = hunkSetup()
    const r = await s.invoke('git:stageHunk', REPO, WT, REG, ['a b.txt'], 1, await diffStamp(s))
    expect(r.ok).toBe(true)
    const apply = s.calls.find(c => c.args[0] === 'apply')
    expect(apply.args).toEqual(['apply', '--cached', '--whitespace=nowarn', '-'])
    expect(apply.child.input).toBe(extractHunk(THREE, 1))
  })

  it('reverses a staged hunk out of the index', async () => {
    const s = hunkSetup()
    await s.invoke('git:unstageHunk', REPO, WT, REG, ['a b.txt'], 0, await diffStamp(s, 'staged'))
    expect(s.calls.find(c => c.args[0] === 'apply').args).toEqual(['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'])
    expect(s.calls.filter(c => c.args[0] === 'diff').at(-1).args).toContain('--cached')
  })

  it('refuses stale, missing, untracked, conflicted and binary hunks without applying', async () => {
    const attempt = async (over, index = 0, stamp = null) => {
      const s = hunkSetup(over)
      const r = await s.invoke('git:stageHunk', REPO, WT, REG, ['a b.txt'], index, stamp ?? await diffStamp(s))
      return [r, s.calls.some(c => c.args[0] === 'apply')]
    }
    expect(await attempt({}, 0, 'old')).toEqual([{ ok: false, stale: true, detail: 'Changed since you reviewed it. Refresh and review again.' }, false])
    expect(await attempt({}, 7)).toEqual([{ ok: false, detail: 'That hunk no longer exists. Refresh and review again.' }, false])
    expect(await attempt({ 'ls-files': { stdout: '' } })).toEqual([{ ok: false, detail: 'Untracked files are staged whole.' }, false])
    expect(await attempt({ 'ls-files': { stdout: '100644 1111111111111111111111111111111111111111 2\ta b.txt\x00' } }))
      .toEqual([{ ok: false, detail: 'Conflicted files are staged whole, after resolving them.' }, false])
    expect(await attempt({ diff: { stdout: 'diff --git a/a b.txt b/a b.txt\nBinary files a/a b.txt and b/a b.txt differ\n' } }))
      .toEqual([{ ok: false, detail: 'Binary or truncated diffs are staged whole.' }, false])
  })

  it('refuses hunks of renamed, copied or mode-changed files', async () => {
    const body = THREE.slice(THREE.indexOf('@@'))
    const headers = [
      'diff --git a/was.txt b/a b.txt\nsimilarity index 90%\nrename from was.txt\nrename to a b.txt\nindex 1111111..2222222 100644\n--- a/was.txt\n+++ b/a b.txt\n',
      'diff --git a/was.txt b/a b.txt\nsimilarity index 90%\ncopy from was.txt\ncopy to a b.txt\n--- a/was.txt\n+++ b/a b.txt\n',
      'diff --git a/a b.txt b/a b.txt\nold mode 100644\nnew mode 100755\nindex 1111111..2222222\n--- a/a b.txt\n+++ b/a b.txt\n',
    ]
    for (const header of headers) {
      for (const [channel, area] of [['git:stageHunk', 'unstaged'], ['git:unstageHunk', 'staged']]) {
        const s = hunkSetup({ diff: { stdout: header + body } })
        const r = await s.invoke(channel, REPO, WT, REG, ['a b.txt'], 0, await diffStamp(s, area))
        expect(r).toEqual({ ok: false, detail: 'Renamed, copied or mode-changed files are staged whole.' })
        expect(s.calls.some(c => c.args[0] === 'apply')).toBe(false)
      }
    }
  })

  it('says a staged deletion is unstaged whole', async () => {
    const deleted = '1 D. N... 100644 000000 000000 1111111111111111111111111111111111111111 0000000000000000000000000000000000000000 a b.txt\x00'
    const s = hunkSetup({ 'ls-files': { stdout: '' }, status: { stdout: deleted } })
    const r = await s.invoke('git:unstageHunk', REPO, WT, REG, ['a b.txt'], 0, await diffStamp(s, 'staged'))
    expect(r).toEqual({ ok: false, detail: 'Deleted files are unstaged whole.' })
  })

  it('writes a hunk of a non-UTF-8 file back byte for byte', async () => {
    const latin = Buffer.concat([Buffer.from(THREE.replace('+TWO', '+caf'), 'latin1')])
    const at = latin.indexOf('+caf') + 4
    const raw = Buffer.concat([latin.subarray(0, at), Buffer.from([0xe9]), latin.subarray(at)])
    const s = hunkSetup({ diff: { stdout: raw } })
    const d = await s.invoke('git:diff', REPO, WT, REG, unstaged())
    expect(d.text).toContain('+caf�')
    expect(d.raw).toBeUndefined()
    expect((await s.invoke('git:stageHunk', REPO, WT, REG, ['a b.txt'], 0, d.stamp)).ok).toBe(true)
    const sent = Buffer.concat(s.calls.find(c => c.args[0] === 'apply').child.inputBytes)
    expect(sent.includes(Buffer.from([0x63, 0x61, 0x66, 0xe9]))).toBe(true)
    expect(sent.equals(Buffer.from(extractHunk(raw.toString('latin1'), 0), 'latin1'))).toBe(true)
  })
})

describe('git:deleteUntracked', () => {
  const STATUS_U = '? new.txt\x00? sub/deep.txt\x00' + STATUS.split('\x00')[0] + '\x00'
  // The default fake probe calls everything a directory; here only non-.txt paths are folders.
  const del = async (paths, probe = {}, stamp = null) => {
    const s = setup(reads({ status: { stdout: STATUS_U } }), { isDirectory: p => !p.endsWith('.txt'), ...probe })
    const r = await s.invoke('git:deleteUntracked', REPO, WT, REG, paths, stamp ?? await s.invoke('git:stamp', REPO, WT, REG, { kind: 'files', paths }))
    return [r, s.deps.probe.unlink.mock.calls.map(c => c[0])]
  }

  it('deletes each untracked file after checking them all', async () => {
    expect(await del(['new.txt', 'sub/deep.txt'])).toEqual([
      { ok: true, detail: 'Deleted 2 untracked files.' }, [path.join(WT, 'new.txt'), path.join(WT, 'sub', 'deep.txt')],
    ])
  })

  it('deletes nothing when any path is tracked, a directory, or under a linked folder', async () => {
    expect(await del(['new.txt', 'a b.txt'])).toEqual([{ ok: false, detail: 'Not an untracked file any more: a b.txt' }, []])
    expect(await del(['new.txt'], { isDirectory: p => p.endsWith('new.txt') || !p.endsWith('.txt') }))
      .toEqual([{ ok: false, detail: 'Refusing a directory: new.txt' }, []])
    expect(await del(['new.txt', 'sub/deep.txt'], { isLink: p => p === path.join(WT, 'sub') }))
      .toEqual([{ ok: false, detail: 'Refusing a path through a linked folder: sub/deep.txt' }, []])
  })

  it('refuses an untracked nested repository folder', async () => {
    const s = setup(reads({ status: { stdout: '? sub/\x00' } }), { isDirectory: p => !p.endsWith('.txt') })
    const r = await s.invoke('git:deleteUntracked', REPO, WT, REG, ['sub/'], await s.invoke('git:stamp', REPO, WT, REG, { kind: 'files', paths: ['sub/'] }))
    expect(r).toEqual({ ok: false, detail: 'Refusing a directory: sub/' })
    expect(s.deps.probe.unlink).not.toHaveBeenCalled()
  })

  it('refuses a stale review and paths outside the worktree', async () => {
    expect(await del(['new.txt'], {}, 'old')).toEqual([{ ok: false, stale: true, detail: 'Changed since you reviewed it. Refresh and review again.' }, []])
    await expect(del(['../outside.txt'])).rejects.toThrow('Invalid file path: ../outside.txt')
  })

  it('reports a file that could not be deleted part-way', async () => {
    const unlink = vi.fn(p => { if (p.endsWith('deep.txt')) throw new Error('EBUSY: resource busy') })
    const [r] = await del(['new.txt', 'sub/deep.txt'], { unlink })
    expect(r).toEqual({ ok: false, detail: 'Deleted 1 of 2 files; could not delete sub/deep.txt: EBUSY: resource busy' })
  })
})

describe('stage 3 history: refs and log', () => {
  const H = HISTORY_CONFIG
  const ORIGIN = 'refs/remotes/origin/main'
  const REC = n => Array.from({ length: n }, (_, i) => `* \x1e${String(i).padStart(40, '0')}\x1f\x1fA\x1fa@b\x1f1\x1f\x1fc${i}`).join('\n') + '\n'
  // Answers the history reads (which carry HISTORY_CONFIG); `over` replaces answers by subcommand.
  const hist = (over = {}) => {
    const base = reads()
    return args => {
      const isHist = H.every((a, i) => args[i] === a)
      const a = isHist ? args.slice(H.length) : args
      if (isHist && a[0] in over) return typeof over[a[0]] === 'function' ? over[a[0]](a) : over[a[0]]
      if (a[0] === 'for-each-ref') return { stdout: `refs/heads/main\nrefs/heads/side\n${ORIGIN}\n` }
      if (a[0] === 'rev-parse' && a.includes('--end-of-options')) return { stdout: `${HEAD}\n` }
      if (a[0] === 'remote') return { stdout: 'origin\n' }
      if (a[0] === 'rev-list') return { stdout: `${HEAD}\n` }
      if (a[0] === 'log') return { stdout: REC(3) }
      return base(a)
    }
  }
  const histCalls = (calls, sub) => calls.filter(c => H.every((a, i) => c.args[i] === a) && c.args[H.length] === sub).map(c => c.args.slice(H.length))
  const logCall = calls => histCalls(calls, 'log')[0]
  const q = over => ({ ref: 'HEAD', filter: 'all', base: null, search: null, limit: 200, ...over })

  it('runs log with the history config, the fixed format and limit + 1', async () => {
    const { invoke, calls } = setup(hist())
    const r = await invoke('git:log', REPO, WT, REG, q())
    const call = calls.find(c => c.args[H.length] === 'log')
    expect(call.raw.slice(0, 3 + H.length)).toEqual(['--no-pager', ...FSMON, ...H])
    expect(logCall(calls)).toEqual(logArgs(q()))
    expect(logCall(calls)).toEqual(['log', '--graph', '--topo-order', '--decorate=full', '--max-count=201', '--no-color', '--no-ext-diff', '--no-textconv',
      '--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s', '--end-of-options', 'HEAD'])
    expect(r).toMatchObject({ tip: HEAD, unpushed: [HEAD], truncated: false, limit: 200 })
    expect(r.text).toBe(REC(3))
  })

  it('puts the unpushed exclusion before --end-of-options', async () => {
    const { invoke, calls } = setup(hist())
    await invoke('git:log', REPO, WT, REG, q({ filter: 'unpushed' }))
    expect(logCall(calls).slice(-5)).toEqual(['--not', '--remotes', '--not', '--end-of-options', 'HEAD'])
    expect(histCalls(calls, 'rev-list')[0]).toEqual(['rev-list', '--max-count=200', '--not', '--remotes', '--not', '--end-of-options', 'HEAD'])
  })

  it('compares with a base as base..ref after --end-of-options', async () => {
    const { invoke, calls } = setup(hist())
    await invoke('git:log', REPO, WT, REG, q({ ref: 'refs/heads/side', filter: 'sinceBase', base: ORIGIN }))
    expect(logCall(calls).slice(-2)).toEqual(['--end-of-options', `${ORIGIN}..refs/heads/side`])
  })

  it('keeps search text inside one argv element, matched literally', async () => {
    const { invoke, calls } = setup(hist())
    await invoke('git:log', REPO, WT, REG, q({ search: { kind: 'message', text: '--all' } }))
    expect(logCall(calls)).toContain('--grep=--all')
    expect(logCall(calls)).not.toContain('--all')
    expect(logCall(calls)).toEqual(expect.arrayContaining(['--fixed-strings', '--regexp-ignore-case']))
    await invoke('git:log', REPO, WT, REG, q({ search: { kind: 'author', text: 'a.b' } }))
    expect(histCalls(calls, 'log')[1]).toContain('--author=a.b')
    await invoke('git:log', REPO, WT, REG, q({ search: { kind: 'path', text: '-x [1].txt' } }))
    const pathLog = histCalls(calls, 'log')[2]
    expect(pathLog.slice(-2)).toEqual(['--', '-x [1].txt'])
    expect(calls.find(c => c.args[H.length] === 'log').opts.env.GIT_LITERAL_PATHSPECS).toBe('1')
  })

  it.each([
    ['a ref that no longer exists', q({ ref: 'refs/heads/gone' }), 'That branch no longer exists.'],
    ['an option-like ref', q({ ref: '-x' }), 'Choose a branch'],
    ['a tag as the base', q({ filter: 'sinceBase', base: 'refs/tags/v1' }), 'Pick a base to compare with'],
    ['a base that no longer exists', q({ filter: 'sinceBase', base: 'refs/remotes/origin/gone' }), 'That branch no longer exists.'],
    ['an odd page size', q({ limit: 300 }), 'Unsupported page size'],
    ['too large a page', q({ limit: 5200 }), 'Unsupported page size'],
    ['a two-line search', q({ search: { kind: 'message', text: 'a\nb' } }), 'Search must be one line'],
    ['a path outside the worktree', q({ search: { kind: 'path', text: '../x' } }), 'Search paths must be inside the worktree'],
    ['an absolute path', q({ search: { kind: 'path', text: path.join(ROOT, 'x') } }), 'Search paths must be inside the worktree'],
    ['an unknown filter', q({ filter: 'weird' }), 'Unknown filter'],
  ])('refuses %s without running log', async (_name, query, message) => {
    const { invoke, calls } = setup(hist())
    await expect(invoke('git:log', REPO, WT, REG, query)).rejects.toThrow(message)
    expect(histCalls(calls, 'log')).toEqual([])
    expect(histCalls(calls, 'rev-list')).toEqual([])
  })

  it('an unborn branch has no tip and runs no log', async () => {
    const { invoke, calls } = setup(hist({ 'rev-parse': { code: 1 } }))
    expect(await invoke('git:log', REPO, WT, REG, q())).toEqual({ text: '', tip: null, unpushed: [], truncated: false, limit: 200 })
    expect(histCalls(calls, 'log')).toEqual([])
  })

  it('with no remotes, unpushed is null and rev-list is skipped', async () => {
    const { invoke, calls } = setup(hist({ remote: { stdout: '' } }))
    expect((await invoke('git:log', REPO, WT, REG, q())).unpushed).toBeNull()
    expect(histCalls(calls, 'rev-list')).toEqual([])
  })

  it('keeps limit commits and says there are more', async () => {
    const { invoke } = setup(hist({ log: { stdout: REC(201) } }))
    const r = await invoke('git:log', REPO, WT, REG, q())
    expect(r.truncated).toBe(true)
    expect(r.text.split('\n').filter(l => l.includes('\x1e'))).toHaveLength(200)
  })

  it('cuts output over 8 MB at a line end', async () => {
    const line = `* \x1e${'0'.repeat(40)}\x1f\x1fA\x1fa@b\x1f1\x1f\x1f${'x'.repeat(1000)}\n`
    const big = line.repeat(Math.ceil((9 * 1024 * 1024) / line.length))
    const { invoke } = setup(hist({ log: { stdout: big } }), {}, { timeoutMs: 5000 })
    const r = await invoke('git:log', REPO, WT, REG, q({ limit: 5000 }))
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(r.text.endsWith('\n')).toBe(true)
  })

  it('reports a slow log with the history timeout message and kills it', async () => {
    const { invoke, deps } = setup(hist({ log: 'hang' }))
    await expect(invoke('git:log', REPO, WT, REG, q())).rejects.toThrow('History took too long - narrow it with a search or a filter.')
    expect(deps.kill).toHaveBeenCalled()
  })

  it('refs returns the ref list, origin HEAD and shallowness', async () => {
    const { invoke, calls } = setup(hist({
      'for-each-ref': { stdout: 'refs/heads/main\0aaa\0\0*\n' },
      'symbolic-ref': { code: 1 },
      'rev-parse': a => (a.includes('--is-shallow-repository') ? { stdout: 'true\n' } : { stdout: `${HEAD}\n` }),
    }))
    expect(await invoke('git:refs', REPO, WT, REG)).toEqual({ refs: 'refs/heads/main\0aaa\0\0*\n', originHead: null, shallow: true })
    expect(histCalls(calls, 'for-each-ref')[0]).toEqual(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(upstream)%00%(HEAD)', 'refs/heads/', 'refs/remotes/', 'refs/tags/'])
  })

  it('refuses an unregistered repository or a folder git does not list, spawning nothing for history', async () => {
    const { invoke, calls } = setup(hist())
    await expect(invoke('git:log', { name: 'X', path: path.join(ROOT, 'X') }, path.join(ROOT, 'X'), REG, q())).rejects.toThrow('Not a registered repository')
    await expect(invoke('git:log', REPO, path.join(WT, 'sub'), REG, q())).rejects.toThrow('Not a worktree')
    await expect(invoke('git:refs', REPO, path.join(WT, 'sub'), REG)).rejects.toThrow('Not a worktree')
    expect(calls.filter(c => H.every((a, i) => c.args[i] === a))).toEqual([])
  })
})

describe('stage 3 history: commit details, files and diffs', () => {
  const H = HISTORY_CONFIG
  const C = 'c'.repeat(40)
  const P1 = '1'.repeat(40)
  const P2 = '2'.repeat(40)
  const hist = (parents = [P1, P2], over = {}) => {
    const base = reads()
    return args => {
      const isHist = H.every((a, i) => args[i] === a)
      const a = isHist ? args.slice(H.length) : args
      if (isHist && a[0] in over) return typeof over[a[0]] === 'function' ? over[a[0]](a) : over[a[0]]
      if (a[0] === 'rev-list') return parents === null ? { code: 128, stderr: 'bad object' } : { stdout: `${[C, ...parents].join(' ')}\n` }
      if (a[0] === 'rev-parse' && a.includes('--end-of-options')) return parents === null ? { code: 1 } : { stdout: `${C}\n` }
      if (a[0] === 'show' || a[0] === 'diff-tree' || a[0] === 'diff') return { stdout: 'out' }
      return base(a)
    }
  }
  const histCalls = (calls, sub) => calls.filter(c => H.every((a, i) => c.args[i] === a) && c.args[H.length] === sub).map(c => c.args.slice(H.length))

  it('reads details with full ref names', async () => {
    const { invoke, calls } = setup(hist())
    expect(await invoke('git:commitDetails', REPO, WT, REG, C)).toEqual({ details: 'out' })
    expect(histCalls(calls, 'show')[0]).toEqual(['show', '-s', '--decorate=full',
      '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%D%x00%B', '--end-of-options', C])
  })

  it('a commit that no longer exists is missing, not an error', async () => {
    const { invoke } = setup(hist(null))
    expect(await invoke('git:commitDetails', REPO, WT, REG, C)).toEqual({ missing: true })
    expect(await invoke('git:commitFiles', REPO, WT, REG, C, P1)).toEqual({ missing: true })
    expect(await invoke('git:commitDiff', REPO, WT, REG, C, P1, ['f'])).toEqual({ missing: true })
  })

  it('lists files against the chosen parent, and a root commit with --root', async () => {
    const { invoke, calls } = setup(hist())
    await invoke('git:commitFiles', REPO, WT, REG, C, P2)
    expect(histCalls(calls, 'diff-tree')[0]).toEqual(['diff-tree', '--no-commit-id', '-r', '-z', '-M', '--name-status', '--no-ext-diff', '--no-textconv', '--end-of-options', P2, C])
    const root = setup(hist([]))
    await root.invoke('git:commitFiles', REPO, WT, REG, C, null)
    expect(histCalls(root.calls, 'diff-tree')[0]).toEqual(['diff-tree', '--no-commit-id', '--root', '-r', '-z', '-M', '--name-status', '--no-ext-diff', '--no-textconv', '--end-of-options', C])
  })

  it('diffs one file against the parent, and a root commit with show', async () => {
    const { invoke, calls } = setup(hist())
    expect(await invoke('git:commitDiff', REPO, WT, REG, C, P1, ['a b.txt'])).toEqual({ text: 'out', truncated: false, binary: false, size: 3 })
    expect(histCalls(calls, 'diff')[0]).toEqual(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-U3', '--end-of-options', P1, C, '--', 'a b.txt'])
    const root = setup(hist([]))
    await root.invoke('git:commitDiff', REPO, WT, REG, C, null, ['f'])
    expect(histCalls(root.calls, 'show')[0]).toEqual(['show', '--format=', '--no-color', '--no-ext-diff', '--no-textconv', '-M', '-U3', '--end-of-options', C, '--', 'f'])
  })

  it('caps a large diff at 1 MB', async () => {
    const { invoke } = setup(hist([P1], { diff: { stdout: 'x'.repeat(1024 * 1024 + 10) } }))
    const r = await invoke('git:commitDiff', REPO, WT, REG, C, P1, ['f'])
    expect(r.truncated).toBe(true)
    expect(r.text).toHaveLength(1024 * 1024)
  })

  it.each([
    ['a symbolic name', 'git:commitDetails', ['HEAD']],
    ['an uppercase id', 'git:commitDetails', [C.toUpperCase()]],
    ['a short id', 'git:commitDetails', ['c'.repeat(39)]],
    ['an option as the parent', 'git:commitFiles', [C, '--all']],
    ['a path outside the worktree', 'git:commitDiff', [C, P1, ['../x']]],
  ])('refuses %s before spawning any history read', async (_n, channel, args) => {
    const { invoke, calls } = setup(hist())
    await expect(invoke(channel, REPO, WT, REG, ...args)).rejects.toThrow()
    expect(calls.filter(c => H.every((a, i) => c.args[i] === a))).toEqual([])
  })

  it.each([
    ['a parent that is not one of the commit\'s', [C, '9'.repeat(40)]],
    ['no parent for a commit that has one', [C, null]],
  ])('refuses %s after reading the parents, with no diff run', async (_n, args) => {
    const { invoke, calls } = setup(hist([P1]))
    await expect(invoke('git:commitFiles', REPO, WT, REG, ...args)).rejects.toThrow('Not a parent of that commit')
    await expect(invoke('git:commitDiff', REPO, WT, REG, ...args, ['f'])).rejects.toThrow('Not a parent of that commit')
    expect(histCalls(calls, 'diff-tree')).toEqual([])
    expect(histCalls(calls, 'diff')).toEqual([])
  })

  it('every history read carries the history config', async () => {
    const { invoke, calls } = setup(hist())
    await invoke('git:commitDetails', REPO, WT, REG, C)
    await invoke('git:commitFiles', REPO, WT, REG, C, P1)
    await invoke('git:commitDiff', REPO, WT, REG, C, P1, ['f'])
    const history = calls.filter(c => ['show', 'diff-tree', 'diff', 'rev-list'].includes(c.args[H.length]))
    expect(history.length).toBeGreaterThanOrEqual(5)
    for (const c of history) expect(c.raw.slice(0, 3 + H.length)).toEqual(['--no-pager', ...FSMON, ...H])
  })
})

describe('stage 4 actions (unit)', () => {
  const OID = 'c'.repeat(40)
  const FORBIDDEN = ['--force', '-f', '--force-with-lease', '--force-if-includes', '--delete', '-D', '--mirror', '--tags', '--hard', 'reset', 'clean']
  // A plausible repository: on main, tracking origin/main, clean, one stash.
  const state = (over = {}) => args => {
    const a = args
    if (a[0] === 'status') return { stdout: over.status ?? '' }
    if (a[0] === 'rev-parse' && a.includes('HEAD') && a.includes('--verify')) return { stdout: `${HEAD}\n` }
    if (a[0] === 'symbolic-ref') return { stdout: 'refs/heads/main\n' }
    if (a[0] === 'rev-parse' && a.includes('--symbolic-full-name')) return { stdout: 'origin/main\n' }
    if (a[0] === 'rev-parse' && a.includes('@{upstream}')) return { stdout: `${'d'.repeat(40)}\n` }
    if (a[0] === 'rev-parse' && a.includes('--git-dir')) return { stdout: `${COMMON}\n${COMMON}\n` }
    if (a[0] === 'rev-parse' && a[2] === '--git-common-dir') return { stdout: `${COMMON}\n` }
    if (a[0] === 'remote') return { stdout: 'origin\n' }
    if (a[0] === 'config' && a.includes('branch.main.remote')) return { stdout: 'origin\n' }
    if (a[0] === 'config') return { code: 1 }
    if (a[0] === 'for-each-ref') return { stdout: 'refs/heads/main\nrefs/heads/side\nrefs/remotes/origin/main\n' }
    if (a[0] === 'rev-list' && a.includes('--left-right')) return { stdout: '0\t1\n' }
    if (a[0] === 'rev-list' && a.includes('--parents')) return { stdout: `${OID} ${'1'.repeat(40)}\n` }
    if (a[0] === 'stash') return { stdout: `${OID}\0stash@{0}\n` }
    if (a[0] === 'check-ref-format') return { code: a[2].startsWith('-') || a[2].startsWith('+') ? 1 : 0 }
    if (a[0] === 'show-ref') return { code: 1 }
    if (a[0] === 'cat-file') return { code: 0 }
    if (a[0] === 'worktree') return { stdout: `worktree ${WT.replace(/\\/g, '/')}\0HEAD ${HEAD}\0branch refs/heads/main\0\0` }
    if (a[0] === 'log') return { stdout: '' }
    return { stdout: '' }
  }
  // Only writes set GIT_MERGE_AUTOEDIT (the environment may already carry a GIT_EDITOR).
  const writes = calls => calls.filter(c => c.opts.env?.GIT_MERGE_AUTOEDIT === 'no')

  it.each([
    ['push', { remote: '-f' }], ['push', { remote: 'origin', dest: '+main' }], ['push', { remote: 'origin', dest: '--force' }],
    ['branch', { name: '--force' }], ['branch', { name: 'x', start: '--all' }], ['checkout', { branch: '--force' }],
    ['checkout', { oid: 'HEAD --force' }], ['revert', { oid: '-f' }], ['worktreeAdd', { ref: 'refs/heads/side', path: '-f' }],
    ['worktreeRemove', { path: '--force' }], ['stashDrop', { oid: '--all' }], ['pull', { mode: 'force' }],
    ['rebaseInteractive', { base: '--root', rows: [] }],
  ])('%s with hostile options %j: refused before any write, no forbidden flag anywhere', async (kind, options) => {
    const { invoke, calls } = setup(state())
    const p = await invoke('git:preview', REPO, WT, REG, kind, options)
    expect(p.eligible).toBe(false)
    const r = await invoke('git:run', REPO, WT, REG, kind, options, 'stamp')
    expect(r.ok).toBe(false)
    expect(writes(calls)).toEqual([])
    for (const c of calls) for (const f of FORBIDDEN) expect(c.args).not.toContain(f)
  })

  it('every write carries the no-op editors and never waits on one', async () => {
    const { invoke, calls } = setup(state())
    const p = await invoke('git:preview', REPO, WT, REG, 'branch', { name: 'feature/x' })
    expect(p.eligible).toBe(true)
    expect(await invoke('git:run', REPO, WT, REG, 'branch', { name: 'feature/x' }, p.stamp)).toMatchObject({ ok: true })
    const [write] = writes(calls)
    expect(write.args).toEqual(['branch', '--no-track', 'feature/x', 'HEAD'])
    expect(write.opts.env).toMatchObject({ GIT_EDITOR: ':', GIT_SEQUENCE_EDITOR: ':', GIT_MERGE_AUTOEDIT: 'no' })
  })

  it('a stale stamp runs nothing', async () => {
    const { invoke, calls } = setup(state())
    expect(await invoke('git:run', REPO, WT, REG, 'pull', { mode: 'ff' }, 'not-the-stamp')).toEqual({ ok: false, stale: true, detail: 'Changed since the preview. Preview again.' })
    expect(writes(calls)).toEqual([])
  })

  it('builds the documented argv for pull and push', async () => {
    const { invoke, calls } = setup(state())
    let p = await invoke('git:preview', REPO, WT, REG, 'pull', { mode: 'ff' })
    await invoke('git:run', REPO, WT, REG, 'pull', { mode: 'ff' }, p.stamp)
    expect(writes(calls).map(c => c.args)).toEqual([['fetch', 'origin'], ['merge', '--ff-only', '--end-of-options', 'origin/main']])
    p = await invoke('git:preview', REPO, WT, REG, 'push', { remote: 'origin', dest: 'review/main', setUpstream: false })
    await invoke('git:run', REPO, WT, REG, 'push', { remote: 'origin', dest: 'review/main', setUpstream: false }, p.stamp)
    expect(writes(calls).at(-1).args).toEqual(['push', '--porcelain', 'origin', 'refs/heads/main:refs/heads/review/main'])
  })

  it('maps a rejected push and a network timeout to their messages', async () => {
    const rejected = setup(state())
    rejected.deps.spawn.mockImplementation((cmd, args, opts) => {
      const a = args.slice(3)
      const r = a[0] === 'push' ? { code: 1, stdout: 'To x\n!\trefs/heads/main:refs/heads/main\t[rejected] (fetch first)\n' } : state()(a)
      return fakeChild(r, 1)
    })
    let p = await rejected.invoke('git:preview', REPO, WT, REG, 'push', { remote: 'origin' })
    expect((await rejected.invoke('git:run', REPO, WT, REG, 'push', { remote: 'origin' }, p.stamp)).detail).toMatch(/^The remote has commits you don't have - pull first\./)
    const slow = setup((a, o) => (a[0] === 'fetch' ? 'hang' : state()(a, o)), {}, { longTimeoutMs: 50 })
    p = await slow.invoke('git:preview', REPO, WT, REG, 'fetch', {})
    expect(await slow.invoke('git:run', REPO, WT, REG, 'fetch', {}, p.stamp)).toEqual({ ok: false, detail: expect.stringMatching(/^git timed out talking to the remotes - a credential or SSH prompt may be waiting/) })
  })

  it('lists the repository programs that will run', async () => {
    const hooks = fs.mkdtempSync(path.join((await import('os')).tmpdir(), 'nexusmd-hooks-'))
    for (const f of ['pre-push', 'pre-push.sample', 'post-merge']) fs.writeFileSync(path.join(hooks, f), '')
    const { invoke } = setup(args => (args[0] === 'config' && args.includes('core.hooksPath') ? { stdout: `${hooks}\n` }
      : args[0] === 'config' && args.includes('--get-regexp') ? { stdout: 'filter.lfs.clean git-lfs clean\nfilter.lfs.smudge git-lfs smudge\ncore.sshcommand ssh -i k\n' }
        : state()(args)))
    const p = await invoke('git:preview', REPO, WT, REG, 'fetch', {})
    expect(p.programs).toEqual(['post-merge hook', 'pre-push hook', 'filter lfs', 'core.sshCommand'])
    fs.rmSync(hooks, { recursive: true, force: true })
  })

  it('refuses unknown kinds outright', async () => {
    const { invoke } = setup(state())
    await expect(invoke('git:preview', REPO, WT, REG, 'reset', {})).rejects.toThrow('Unknown action: reset')
    await expect(invoke('git:run', REPO, WT, REG, '__proto__', {}, 'x')).rejects.toThrow('Unknown action')
  })
})
