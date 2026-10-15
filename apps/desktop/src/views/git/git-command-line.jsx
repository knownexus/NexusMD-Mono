import React from 'react'

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

const QUICK = [
  ['git status', 'status'],
  ['git log --oneline -5', 'log --oneline -5'],
  ['git stash', 'stash push'],
  ['git switch -c', null, 'switch -c '],
]

/**
 * A git command line for the selected worktree. Calls onRun(argv) without the leading "git".
 * Up / Down step through this session's history.
 */
export function GitCommandLine({ path, onRun, disabled = false }) {
  const [value, setValue] = React.useState('')
  const [past, setPast] = React.useState([])
  const [idx, setIdx] = React.useState(-1)
  const input = React.useRef(null)

  const submit = (line = value) => {
    const c = line.trim().replace(/^git\s+/, '')
    if (!c || disabled) return
    setPast(p => [c, ...p.filter(x => x !== c)].slice(0, 20))
    setIdx(-1)
    setValue('')
    onRun(splitArgs(c))
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

  return (
    <div>
      <div className="nx-cmd">
        <span className="nx-cmd-prefix" aria-hidden="true">git</span>
        <input ref={input} aria-label="git command" value={value} disabled={disabled} spellCheck={false}
          placeholder="status, stash, switch -c feature/..., log -5" onChange={e => setValue(e.target.value)} onKeyDown={onKeyDown} />
        <button className="btn sm" disabled={disabled || !value.trim()} onClick={() => submit()}>Run</button>
      </div>
      <div className="nx-cmd-hint">
        <span>Runs in <span className="nx-mono" style={{ color: 'var(--text)' }}>{path}</span> · Enter to run · ↑ for previous</span>
        <span style={{ flex: 1 }} />
        {QUICK.map(([label, cmd, fill]) => (
          <button key={label} className="nx-chip" disabled={disabled}
            onClick={() => (cmd ? submit(cmd) : (setValue(fill), input.current?.focus()))}>{label}</button>
        ))}
      </div>
    </div>
  )
}
