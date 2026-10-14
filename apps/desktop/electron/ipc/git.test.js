// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { register, gitEnv, isRepositoryRoot, findGit } from './git.cjs'

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
  child.stdin.on('data', c => { child.input += c })
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
      isLink: () => false, size: () => null, readBytes: () => null, unlink: vi.fn(), ...probe,
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
  if (args[0] === 'ls-files') return { stdout: LS }
  if (args[0] === 'status') return { stdout: STATUS }
  if (args[0] === 'diff') return { stdout: 'diff --git a/a b.txt b/a b.txt\n' }
  return { stdout: '' }
}
const unstaged = (paths = ['a b.txt']) => ({ area: 'unstaged', paths })

describe('stage 2 reads', () => {
  it('sets literal pathspecs for every git call', () => {
    expect(gitEnv({}).GIT_LITERAL_PATHSPECS).toBe('1')
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
