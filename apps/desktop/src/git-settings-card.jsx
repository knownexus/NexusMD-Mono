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

export function GitSettingsCard({ adapter = gitAdapter, picker = pickerAdapter }) {
  const config = useGitConfig()
  const [rootsText, setRootsText] = React.useState(() => effectiveRoots(getGitConfig()).join('; '))
  const [message, setMessage] = React.useState(null)
  if (!adapter.isAvailable()) return null

  const addRepo = async () => {
    const dir = await picker.pickDirectory()
    if (!dir) return
    try {
      setGitConfig(await registerRepo(getGitConfig(), dir, adapter))
      setMessage({ ok: true, text: `Added ${dir}` })
    } catch (e) {
      setMessage({ ok: false, text: e.message })
    }
  }
  const saveRoots = async () => {
    const { roots, invalid } = parseRoots(rootsText)
    if (invalid.length) { setMessage({ ok: false, text: `Use absolute folders: ${invalid.join(', ')}` }); return }
    setGitConfig({ roots })
    if (!roots.length) { setMessage({ ok: true, text: 'No search folders · the group editor shows registered repositories only' }); return }
    const missing = (await adapter.checkFolders(roots)).filter(f => !f.exists).map(f => f.path)
    setMessage({ ok: !missing.length, text: `Saved ${roots.length} search folder${roots.length === 1 ? '' : 's'}${missing.length ? ` · not found: ${missing.join(', ')}` : ''}` })
  }

  return (
    <VsCard title="Git Workspace" icon="git-branch">
      <VsRow title="Search folders" desc="Folders whose immediate subfolders are offered as repositories in the group editor. Separate with ; — leave empty to turn discovery off.">
        <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="Search folders" style={inputStyle} value={rootsText} onChange={e => setRootsText(e.target.value)} />
          <button className="btn sm" onClick={saveRoots}>Save folders</button>
        </div>
      </VsRow>
      <VsRow title="Repositories" desc="Removing a repository only unregisters it; its files stay in place.">
        <div style={{ display: 'grid', gap: 4 }}>
          {config.repos.length === 0 && <span style={{ color: 'var(--text-muted)' }}>None registered.</span>}
          {config.repos.map(r => (
            <div key={r.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>{r.name} <span style={{ color: 'var(--text-muted)' }}>{r.path}</span></span>
              <button className="btn sm ghost" aria-label={`Remove ${r.name}`} onClick={() => setGitConfig(unregisterRepo(getGitConfig(), r.name))}>Remove</button>
            </div>
          ))}
          <div><button className="btn sm" onClick={addRepo}>Add repository…</button></div>
        </div>
      </VsRow>
      {message && <div role="status" style={{ padding: '6px 12px', color: message.ok ? 'var(--success)' : 'var(--danger)' }}>{message.text}</div>}
    </VsCard>
  )
}
