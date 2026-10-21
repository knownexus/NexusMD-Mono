// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { registerShell, definedNames } from './git-shell.cjs'

const FOLDER = path.resolve('/dots')
const WT = path.resolve('/repos/A')
const REPO = { name: 'A', path: WT }
const PROFILE = { '12-git-core.ps1': 'function global:g! { gstat }\nfunction global:gstat {\n}\nSet-Alias -Name gs2 -Value gstat\n' }

// A stand-in pwsh: each line written to stdin ends with the end marker, which it echoes after `reply(line)`.
function fakePwsh(reply = () => '') {
  const spawned = []
  const spawn = vi.fn((exe, args, opts) => {
    const child = new EventEmitter()
    child.pid = 100 + spawned.length
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.lines = []
    child.stdin = {
      write(line) {
        child.lines.push(line)
        const out = reply(line, child)
        if (out === null) return
        const marker = /"`n(<<nexusmd-end \w+ )"/.exec(line)[1]
        const failed = line.includes('__nxFail')
        setTimeout(() => child.stdout.write(`${out}\n${marker}${failed ? 'failed' : 'ok'}>>\n`), 0)
      },
    }
    child.opts = opts
    spawned.push(child)
    return child
  })
  return { spawn, spawned }
}

function setup(over = {}) {
  const handlers = {}
  const pwsh = fakePwsh(over.reply)
  const kill = vi.fn(async () => {})
  const fsx = {
    readdirSync: () => Object.keys(PROFILE),
    readFileSync: p => PROFILE[path.basename(p)],
  }
  const shell = registerShell((channel, fn) => { handlers[channel] = fn }, {
    spawn: pwsh.spawn, kill, fsx, timeoutMs: over.timeoutMs ?? 2000,
    requireExactWorktree: async (repo, wt, reg, validate) => validate(),
    isRemoteOrDevicePath: p => p.startsWith('\\\\'),
  })
  const run = (name, args = []) => handlers['git:shellRun'](null, REPO, WT, [WT], FOLDER, name, args)
  return { run, warm: f => handlers['git:shellWarm'](null, f), pwsh, kill, shell }
}

describe('git:shellRun', () => {
  it('reads the defined function and alias names', () => {
    expect([...definedNames(PROFILE['12-git-core.ps1'])]).toEqual(['g!', 'gstat', 'gs2'])
  })

  it('loads the profile once in one pwsh, then runs each command in the worktree with its arguments quoted', async () => {
    // Colours stay for the output drawer; a screen reset and a cursor move don't.
    const { run, pwsh } = setup({ reply: line => (line.includes("& 'g!'") ? '\x1bc\x1b[2K\x1b[1mbranch:\x1b[0m main' : '') })
    expect(await run('g!', ["it's", '-v'])).toEqual({ code: 0, stdout: '\x1b[1mbranch:\x1b[0m main', stderr: '' })
    await run('gs2')
    expect(pwsh.spawn).toHaveBeenCalledTimes(1)
    const [exe, args, opts] = pwsh.spawn.mock.calls[0]
    expect([exe, args]).toEqual(['pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-']])
    expect(opts.env).toMatchObject({ GIT_EDITOR: 'false', GIT_SEQUENCE_EDITOR: 'false', GIT_TERMINAL_PROMPT: '0' })
    const [load, first] = pwsh.spawned[0].lines
    expect(load).toContain(`Get-ChildItem -LiteralPath '${path.join(FOLDER, 'pwsh', 'profile.d')}' -Filter *.ps1`)
    expect(first).toContain(`Set-Location -LiteralPath '${WT}'`)
    expect(first).toContain("$__nxArgs = @('it''s', '-v'); & 'g!' @__nxArgs *>&1")
  })

  it('refuses a name the profile does not define, or a bad folder, without starting pwsh', async () => {
    const { run, pwsh } = setup()
    await expect(run('Remove-Item')).rejects.toThrow(`Remove-Item isn't defined in ${path.join(FOLDER, 'pwsh', 'profile.d')}.`)
    await expect(run('g! ; rm')).rejects.toThrow('Not a DotFiles command.')
    await expect(run('g!', [1])).rejects.toThrow('Invalid arguments.')
    expect(pwsh.spawn).not.toHaveBeenCalled()
  })

  it('reports a command that threw as failed', async () => {
    const { run } = setup({ reply: line => (line.includes("& 'g!'") ? 'boom' : '') })
    const r = await run('g!', ['__nxFail'])
    expect(r).toMatchObject({ code: 1, stdout: 'boom' })
  })

  it('stops a command that runs too long and starts a fresh pwsh next time', async () => {
    let hang = true
    const { run, pwsh, kill } = setup({ timeoutMs: 50, reply: line => (line.includes("& 'g!'") && hang ? null : '') })
    await expect(run('g!')).rejects.toThrow('It took longer than 0s, so PowerShell was stopped.')
    expect(kill).toHaveBeenCalledWith(100)
    hang = false
    expect(await run('g!')).toMatchObject({ code: 0 })
    expect(pwsh.spawn).toHaveBeenCalledTimes(2)
  })

  it('says pwsh is needed when it cannot be started', async () => {
    const { run, pwsh } = setup({ reply: (line, child) => { child.emit('error', new Error('spawn pwsh ENOENT')); return null } })
    await expect(run('g!')).rejects.toThrow('PowerShell 7 (pwsh) is needed to run DotFiles scripts: spawn pwsh ENOENT')
    expect(pwsh.spawn).toHaveBeenCalledTimes(1)
  })

  it('warms a session up ahead of time, and disposeAll stops it', async () => {
    const { warm, shell, kill, pwsh } = setup()
    expect(await warm(FOLDER)).toBe(true)
    expect(await warm('relative')).toBe(false)
    await shell.disposeAll()
    expect(kill).toHaveBeenCalledWith(pwsh.spawned[0].pid)
  })
})
