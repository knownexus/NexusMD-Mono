import React from 'react'
import { VsCard, VsRow } from '@nexusmd/ui'
import { registerRepo, unregisterRepo } from '@nexusmd/core'
import { getGitConfig, setGitConfig, effectiveRoots, parseRoots } from './git-config.js'
import { useGitConfig } from './views/git/use-git-config.js'
import { gitAdapter } from './adapters/git.js'
import { pickerAdapter } from './adapters/picker.js'

const inputStyle = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
}

const IPC_PREFIX = /^Error invoking remote method '[^']*': (Error: )?/

function cleanError(e) {
  return String(e?.message ?? e).replace(IPC_PREFIX, '')
}

const sameRepos = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function GitSettingsCard({ adapter = gitAdapter, picker = pickerAdapter }) {
  const config = useGitConfig()
  const [rootsText, setRootsText] = React.useState(() => effectiveRoots(getGitConfig()).join('; '))
  const [message, setMessage] = React.useState(null)
  const [missing, setMissing] = React.useState(() => new Set())
  const [adding, setAdding] = React.useState(false)
  const addingRef = React.useRef(false)
  const checkRef = React.useRef(0)
  const available = adapter.isAvailable()
  const savedRoots = effectiveRoots(config)
  const checkKey = JSON.stringify([config.repos.map(r => r.path), savedRoots])

  React.useEffect(() => {
    if (!available) return
    const [repoPaths, roots] = JSON.parse(checkKey)
    const id = ++checkRef.current
    Promise.resolve()
      .then(() => adapter.checkFolders([...repoPaths, ...roots]))
      .then(found => {
        if (id === checkRef.current) setMissing(new Set(found.filter(f => !f.exists).map(f => f.path)))
      })
      .catch(() => { /* the flags are advisory; the view reports unavailable repos itself */ })
  }, [adapter, available, checkKey])

  if (!available) return null
  const locked = config.unsupported != null
  const missingRoots = savedRoots.filter(r => missing.has(r))

  const addRepo = async () => {
    if (locked || addingRef.current) return
    addingRef.current = true
    setAdding(true)
    try {
      const dir = await picker.pickDirectory()
      if (!dir) return
      // registerRepo awaits git; register against settings that changed meanwhile, not a stale copy.
      let next
      for (let attempt = 0; attempt < 3; attempt++) {
        const base = getGitConfig()
        next = await registerRepo(base, dir, adapter)
        if (sameRepos(getGitConfig().repos, base.repos)) break
      }
      setGitConfig({ repos: next.repos })
      setMessage({ ok: true, text: `Added ${next.repos[next.repos.length - 1].name}` })
    } catch (e) {
      setMessage({ ok: false, text: cleanError(e) })
    } finally {
      addingRef.current = false
      setAdding(false)
    }
  }
  const saveRoots = async () => {
    if (locked) return
    const { roots, invalid, network } = parseRoots(rootsText)
    if (network.length) { setMessage({ ok: false, text: `Network (UNC) paths aren't supported: ${network.join(', ')}` }); return }
    if (invalid.length) { setMessage({ ok: false, text: `Use absolute folders: ${invalid.join(', ')}` }); return }
    setGitConfig({ roots })
    if (!roots.length) { setMessage({ ok: true, text: 'No search folders · the group editor shows registered repositories only' }); return }
    let missing
    try {
      missing = (await adapter.checkFolders(roots)).filter(f => !f.exists).map(f => f.path)
    } catch {
      setMessage({ ok: false, text: "Saved, but couldn't check the folders" })
      return
    }
    setMessage({ ok: !missing.length, text: `Saved ${roots.length} search folder${roots.length === 1 ? '' : 's'}${missing.length ? ` · not found: ${missing.join(', ')}` : ''}` })
  }

  return (
    <VsCard title="Git Workspace" icon="git-branch">
      {locked && (
        <div role="status" style={{ padding: '6px 12px', color: 'var(--text-muted)' }}>
          {`These Git Workspace settings were saved by a newer NexusMD (version ${config.unsupported}) and can't be edited here.`}
        </div>
      )}
      <VsRow title="Search folders" desc="Folders whose immediate subfolders are offered as repositories in the group editor. Separate with ; — leave empty to turn discovery off.">
        <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="Search folders" style={inputStyle} value={rootsText} disabled={locked} onChange={e => setRootsText(e.target.value)} />
          <button className="btn sm" disabled={locked} onClick={saveRoots}>Save folders</button>
        </div>
        {missingRoots.length > 0 && <div style={{ marginTop: 4, color: 'var(--danger)' }}>{`Not found: ${missingRoots.join(', ')}`}</div>}
      </VsRow>
      <VsRow title="Repositories" desc="Removing a repository only unregisters it; its files stay in place.">
        <div style={{ display: 'grid', gap: 4 }}>
          {config.repos.length === 0 && <span style={{ color: 'var(--text-muted)' }}>None registered.</span>}
          {config.repos.map(r => (
            <div key={r.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>
                {r.name} <span style={{ color: 'var(--text-muted)' }}>{r.path}</span>
                {missing.has(r.path) && <> · <span style={{ color: 'var(--danger)' }}>not found</span></>}
              </span>
              <button className="btn sm ghost" aria-label={`Remove ${r.name}`} disabled={locked}
                onClick={() => { setMessage(null); setGitConfig(unregisterRepo(getGitConfig(), r.name)) }}>Remove</button>
            </div>
          ))}
          <div><button className="btn sm" disabled={locked || adding} onClick={addRepo}>Add repository…</button></div>
        </div>
      </VsRow>
      {message && <div role="status" style={{ padding: '6px 12px', color: message.ok ? 'var(--success)' : 'var(--danger)' }}>{message.text}</div>}
    </VsCard>
  )
}
