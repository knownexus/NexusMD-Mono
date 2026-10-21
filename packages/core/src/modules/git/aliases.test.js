import { describe, it, expect } from 'vitest'
import { parseAliases, parseShellAliases, parseShellScripts } from './aliases.js'

describe('parseAliases', () => {
  it('reads name and expansion, lets a later definition win, sorts by name and marks shell aliases', () => {
    const raw = 'alias.st\nstatus -sb\0alias.undo\nreset --soft HEAD~1\0alias.st\nstatus\0alias.who\n!git log --format=%an | sort -u\0'
    expect(parseAliases(raw)).toEqual([
      { name: 'st', expansion: 'status', shell: false },
      { name: 'undo', expansion: 'reset --soft HEAD~1', shell: false },
      { name: 'who', expansion: '!git log --format=%an | sort -u', shell: true },
    ])
  })

  it('handles nothing, an empty value and stray entries', () => {
    expect(parseAliases('')).toEqual([])
    expect(parseAliases(null)).toEqual([])
    expect(parseAliases('alias.empty\0core.x\ny\0alias.\nnope\0')).toEqual([{ name: 'empty', expansion: '', shell: false }])
  })
})

describe('parseShellAliases', () => {
  it('reads one-line git shortcuts, Invoke-GitPaged ones and Set-Alias names for them', () => {
    const text = [
      '# Add',
      'function global:ga    { git add @args }',
      'function global:uncommit { git reset --soft HEAD^ }',
      'function global:gdfs { Invoke-GitPaged diff --staged --color=always @args }',
      "function global:grd  { if (-not (Assert-GitRepo)) { return }; git rebase develop @args }",
      'function global:rs { Clear-Host; git status }',
      'function global:git-commit { git commit @args }',
      'Set-Alias -Name gc -Value git-commit -Force -Option AllScope',
      'Set-Alias wt-setup New-GitWorktreeSetup',
    ].join('\r\n')
    expect(parseShellAliases(text)).toEqual([
      { name: 'ga', expansion: 'add', takesArgs: true },
      { name: 'gc', expansion: 'commit', takesArgs: true },
      { name: 'gdfs', expansion: 'diff --staged', takesArgs: true },
      { name: 'git-commit', expansion: 'commit', takesArgs: true },
      { name: 'grd', expansion: 'rebase develop', takesArgs: true },
      { name: 'rs', expansion: 'status', takesArgs: false },
      { name: 'uncommit', expansion: 'reset --soft HEAD^', takesArgs: false },
    ])
  })

  it('skips scripts, other commands and anything that needs a terminal', () => {
    const text = [
      'function global:g!   { gstat }',
      'function global:gpf   { Confirm-ForcePush @args }',
      'function global:gaw { git diff -w | git apply --cached }',
      'function global:gdv  { git difftool --no-prompt --tool=vimdiff @args }',
      'function global:groot  { git rebase -i --root master }',
      'function global:gtag { git tag $name }',
      'function global:gstat {',
      '    git status',
      '}',
    ].join('\n')
    expect(parseShellAliases(text)).toEqual([])
    expect(parseShellAliases(null)).toEqual([])
  })
})

describe('parseShellScripts', () => {
  it('lists the git scripts and aliases for them, not shortcuts, helpers, terminal-only ones or other files', () => {
    const text = [
      '# nexusmd-file: 10-ls.ps1',
      'function global:ll { Get-ChildItem }',
      '# nexusmd-file: 12-git-core.ps1',
      'function global:Assert-GitRepo {',
      'function global:gstat {',
      '    git status',
      '}',
      'function global:g!   { gstat }',
      'function global:ga    { git add @args }',
      'function global:gdv  { git difftool --no-prompt --tool=vimdiff @args }',
      'function global:Invoke-RebaseOnto { param($x) }',
      'Set-Alias -Name rebaseon -Value Invoke-RebaseOnto',
      'Set-Alias -Name gitl -Value gl -Force',
      'function global:gl { git log --graph | less }',
    ].join('\n')
    expect(parseShellScripts(text).map(s => s.name)).toEqual(['g!', 'gitl', 'gl', 'gstat', 'rebaseon'])
  })

  it('counts every file without the marks', () => {
    expect(parseShellScripts('function global:ll { Get-ChildItem }')).toEqual([{ name: 'll' }])
    expect(parseShellScripts('')).toEqual([])
  })
})
