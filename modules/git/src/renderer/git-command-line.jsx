import React from 'react'
import { createPortal } from 'react-dom'

// Splits a command line into argv, honouring "double" and 'single' quotes.
export function splitArgs(line) {
  const out = []
  let cur = '', quote = null, any = false
  for (const ch of line) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue }
    if (ch === '"' || ch === "'") { quote = ch; any = true; continue }
    if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ''; any = false; continue }
    cur += ch
  }
  if (cur || any) out.push(cur)
  return out
}

// Each command starts with "git", so a DotFiles shortcut of the same name (stash) never takes it over.
const QUICK = [
  ['status', 'git status'],
  ['log -5', 'git log --oneline -5'],
  ['stash', 'git stash push'],
  ['switch -c', null, 'git switch -c '],
]
const NO_ALIASES = { git: [], shell: [], scripts: [] }
// A menu row spans the menu's two columns and shares them (subgrid), so every alias and every
// command it runs line up, both left aligned.
const ROW = {
  gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'subgrid', columnGap: 16,
  justifyItems: 'start', alignItems: 'center', textAlign: 'left', minWidth: 0,
}

/**
 * A git command line for the selected worktree, read the way the user's shell would: a DotFiles
 * shortcut (`ga .`, `uncommit`) runs the git command it stands for, a DotFiles script (`g!`) runs in
 * PowerShell, and anything else is git's, with or without a leading "git". Calls onRun(argv) without
 * the "git", plus the git alias when argv starts with one, or { script: true } for a script.
 * loadAliases() resolves to { git, shell, scripts }: core's parseAliases, parseShellAliases and
 * parseShellScripts lists. Up / Down step through this session's history. `lead` goes first in the
 * hint row (the dock's "Output ▴" chip).
 */
export function GitCommandLine({ path, onRun, disabled = false, loadAliases = null, lead = null }) {
  const [value, setValue] = React.useState('')
  const [aliases, setAliases] = React.useState(NO_ALIASES)
  // The open menu's fixed position, or null. It's drawn on document.body so the panel's overflow can't clip it.
  const [aliasMenu, setAliasMenu] = React.useState(null)
  const chip = React.useRef(null)
  const menu = React.useRef(null)
  const reloadAliases = React.useCallback(() => {
    if (!loadAliases) return undefined
    let live = true
    Promise.resolve().then(loadAliases).then(a => { if (live) setAliases({ ...NO_ALIASES, ...a }) }, () => { if (live) setAliases(NO_ALIASES) })
    return () => { live = false }
  }, [loadAliases])
  React.useEffect(() => reloadAliases(), [path]) // eslint-disable-line react-hooks/exhaustive-deps
  const [past, setPast] = React.useState([])
  const [idx, setIdx] = React.useState(-1)
  const input = React.useRef(null)
  const count = aliases.git.length + aliases.shell.length + aliases.scripts.length

  const submit = (line = value) => {
    const c = line.trim()
    if (!c || disabled) return
    setPast(p => [c, ...p.filter(x => x !== c)].slice(0, 20))
    setIdx(-1)
    setValue('')
    const viaGit = /^git\s+/.test(c)
    const argv = splitArgs(c.replace(/^git\s+/, ''))
    const shell = !viaGit && aliases.shell.find(a => a.name === argv[0])
    if (shell) { onRun([...splitArgs(shell.expansion), ...(shell.takesArgs ? argv.slice(1) : [])]); return }
    if (!viaGit && aliases.scripts.some(a => a.name === argv[0])) { onRun(argv, { script: true }); return }
    const alias = aliases.git.find(a => a.name === argv[0])
    if (alias) onRun(argv, alias)
    else onRun(argv)
  }
  // Opens above the chip or below it, whichever has more room, no taller than that room.
  const openMenu = () => {
    reloadAliases()
    const r = chip.current.getBoundingClientRect()
    const above = r.top
    const below = window.innerHeight - r.bottom
    const up = above > below
    setAliasMenu({
      right: Math.max(8, window.innerWidth - r.right),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      maxHeight: Math.max(120, Math.min(420, (up ? above : below) - 12)),
    })
  }
  React.useEffect(() => {
    if (!aliasMenu) return undefined
    const close = e => {
      if (e.target instanceof Node && (menu.current?.contains(e.target) || chip.current?.contains(e.target))) return
      setAliasMenu(null)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [aliasMenu])
  const fill = text => {
    setAliasMenu(null)
    setValue(text)
    input.current?.focus()
  }
  const onKeyDown = e => {
    if (e.key === 'Enter') { e.preventDefault(); submit() }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && past.length) {
      e.preventDefault()
      const i = Math.max(-1, Math.min(past.length - 1, idx + (e.key === 'ArrowUp' ? 1 : -1)))
      setIdx(i)
      setValue(i < 0 ? '' : past[i])
    }
  }
  const item = (name, expansion, typed, runs = `git ${expansion}`) => (
    <button key={typed} role="menuitem" aria-label={typed.trim()} title={`${typed.trim()} → ${runs}`} className="btn sm ghost"
      style={ROW} onClick={() => fill(typed)}>
      <span className="nx-mono" style={{ color: 'var(--text)' }}>{name}</span>
      <span className="nx-mono" style={{ color: 'var(--text-muted)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{runs}</span>
    </button>
  )
  const heading = text => <div style={{ gridColumn: '1 / -1', padding: '4px 8px 0', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{text}</div>

  return (
    <div>
      <div className="nx-cmd">
        <span className="nx-cmd-prompt" aria-hidden="true">git ›</span>
        <input ref={input} aria-label="git command" value={value} disabled={disabled} spellCheck={false}
          placeholder="status, ga ., uncommit, log -5" onChange={e => setValue(e.target.value)} onKeyDown={onKeyDown} />
        <span className="kbd nx-cmd-kbd" title="Press ` to focus the command line">`</span>
        <button className="btn sm" disabled={disabled || !value.trim()} onClick={() => submit()}>Run</button>
      </div>
      <div className="nx-cmd-hint">
        {lead}
        <span className="nx-cmd-where" title={path}>in <span className="nx-mono" style={{ color: 'var(--text)' }}>{path}</span> · Enter to run · ↑ previous · Esc minimises output</span>
        <span style={{ flex: 1 }} />
        {QUICK.map(([label, cmd, text]) => (
          <button key={label} className="nx-chip" disabled={disabled} title={cmd ?? text.trim()}
            onClick={() => (cmd ? submit(cmd) : (setValue(text), input.current?.focus()))}>{label}</button>
        ))}
        {loadAliases && (
          <span>
            <button ref={chip} className="nx-chip" disabled={disabled} aria-haspopup="menu" aria-expanded={!!aliasMenu}
              onClick={() => (aliasMenu ? setAliasMenu(null) : openMenu())}>{`My aliases (${count}) ▾`}</button>
            {aliasMenu && createPortal(
              <div ref={menu} role="menu" aria-label="My aliases" className="card" onKeyDown={e => { if (e.key === 'Escape') { setAliasMenu(null); chip.current?.focus() } }}
                style={{ position: 'fixed', ...aliasMenu, zIndex: 1000, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', alignContent: 'start', gap: 2, padding: 4, minWidth: 260, maxWidth: 560, overflow: 'auto', boxShadow: 'var(--shadow-lg)' }}>
                {count === 0 && <span style={{ gridColumn: '1 / -1', padding: '4px 8px' }}>No aliases found. Set your DotFiles folder in Settings → Desktop → Git Workspace, or add a git alias with git config --global alias.&lt;name&gt; "&lt;command&gt;".</span>}
                {aliases.shell.length > 0 && heading('DotFiles')}
                {aliases.shell.map(a => item(a.name, a.expansion, `${a.name}${a.takesArgs ? ' ' : ''}`))}
                {aliases.scripts.length > 0 && heading('DotFiles scripts')}
                {aliases.scripts.map(a => item(a.name, null, `${a.name} `, 'PowerShell script'))}
                {aliases.git.length > 0 && heading('git config')}
                {aliases.git.map(a => item(`git ${a.name}`, a.expansion, `git ${a.name} `))}
              </div>,
              document.body,
            )}
          </span>
        )}
      </div>
    </div>
  )
}
