// packages/core/src/modules/git/aliases.js
//
// The user's git aliases, for the Git Workspace command line's picker.

/**
 * Parses `git config -z --get-regexp ^alias\.`: entries are "alias.<name>\n<expansion>\0". A later
 * definition (a repository's over the global one) wins. Sorted by name; `shell` marks a "!" alias.
 */
export function parseAliases(raw) {
  const byName = new Map()
  for (const entry of String(raw ?? '').split('\0')) {
    if (!entry.startsWith('alias.')) continue
    const nl = entry.indexOf('\n')
    const name = nl < 0 ? entry.slice(6) : entry.slice(6, nl)
    const expansion = nl < 0 ? '' : entry.slice(nl + 1).trim()
    if (name) byName.set(name, { name, expansion, shell: expansion.startsWith('!') })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const FUNCTION = /^function\s+global:(\S+)\s*\{(.*)\}\s*$/
const SET_ALIAS = /^Set-Alias\s+(?:-Name\s+)?(\S+)\s+(?:-Value\s+)?([^\s#]+)/
const GUARD = /^if\s*\(-not\s*\(Assert-GitRepo\)\)\s*\{\s*return\s*\};?\s*/
// Anything that needs a terminal (an editor or vimdiff) can't run from the app.
const NEEDS_TERMINAL = /^difftool\b|(^|\s)(-i|--interactive|-p|--patch)(\s|$)/

/**
 * Reads PowerShell profile scripts (DotFiles' pwsh/profile.d) for the one-line git shortcuts:
 * `function global:ga { git add @args }`, the same through Invoke-GitPaged (its --color=always
 * dropped), and Set-Alias names for them. Anything else in a body (variables, pipes, a second
 * command) makes it a script, which is skipped. `takesArgs` is whether the shortcut passes @args on.
 */
export function parseShellAliases(text) {
  const byName = new Map()
  const pointers = []
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    const set = SET_ALIAS.exec(line)
    if (set) { pointers.push([set[1], set[2]]); continue }
    const fn = FUNCTION.exec(line)
    if (!fn) continue
    const body = fn[2].trim().replace(GUARD, '').replace(/^Clear-Host\s*;\s*/, '')
    const cmd = /^(?:git|Invoke-GitPaged)\s+(.+)$/.exec(body)
    if (!cmd) continue
    const takesArgs = /(^|\s)@args\s*$/.test(cmd[1])
    const rest = cmd[1].replace(/\s*@args\s*$/, '').replace(/\s*--color=always\b/g, '').trim()
    if (!rest || /[$|;{}()`@<>&]/.test(rest) || NEEDS_TERMINAL.test(rest)) continue
    byName.set(fn[1], { name: fn[1], expansion: rest, takesArgs })
  }
  for (const [name, target] of pointers) {
    const to = byName.get(target)
    if (to && !byName.has(name)) byName.set(name, { ...to, name })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const FUNCTION_START = /^function\s+global:([^\s{(]+)/
const FILE_MARK = /^# nexusmd-file: (.+)$/
// PowerShell's Verb-Noun helpers (Invoke-GitPaged, Assert-GitRepo) are building blocks, not commands.
const HELPER = /^[A-Z][a-z]+-[A-Z]/

/**
 * The DotFiles git functions that are scripts rather than one-line shortcuts (g!, gstat, gpf), and
 * Set-Alias names for them, to run in PowerShell itself. With the main process's `# nexusmd-file:`
 * marks, only files named for git count; one-line git shortcuts that need a terminal are left out.
 */
export function parseShellScripts(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim())
  const shortcuts = new Set(parseShellAliases(text).map(a => a.name))
  const functions = new Set()
  const terminal = new Set()
  const pointers = []
  let gitFile = true
  for (const line of lines) {
    const file = FILE_MARK.exec(line)
    if (file) { gitFile = /git/i.test(file[1]); continue }
    if (!gitFile) continue
    const set = SET_ALIAS.exec(line)
    if (set) { pointers.push([set[1], set[2]]); continue }
    const fn = FUNCTION_START.exec(line)
    if (!fn) continue
    const one = FUNCTION.exec(line)
    const git = one && /^(?:git|Invoke-GitPaged)\s+(.+)$/.exec(one[2].trim().replace(GUARD, ''))
    if (git && NEEDS_TERMINAL.test(git[1])) terminal.add(fn[1])
    else functions.add(fn[1])
  }
  const runnable = name => functions.has(name) && !shortcuts.has(name) && !terminal.has(name)
  const names = [...functions].filter(n => runnable(n) && !HELPER.test(n))
  for (const [name, target] of pointers) {
    if (!shortcuts.has(name) && !names.includes(name) && runnable(target)) names.push(name)
  }
  return names.sort((a, b) => a.localeCompare(b)).map(name => ({ name }))
}
