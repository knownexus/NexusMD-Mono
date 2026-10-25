import React from 'react'
import { VsCard, VsRow } from '@nexusmd/ui'
import { registerRepo, unregisterRepo, parseShellAliases } from '@nexusmd/core'
import { getGitConfig, setGitConfig, effectiveRoots, effectiveDotfiles, parseRoots } from './git-config.js'
import { useGitConfig } from './use-git-config.js'
import { gitAdapter } from './git-adapter.js'

const inputStyle = {
  width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13,
}

const IPC_PREFIX = /^Error invoking remote method '[^']*': (Error: )?/

function cleanError(e) {
  return String(e?.message ?? e).replace(IPC_PREFIX, '')
}

const sameRepos = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function GitSettingsCard({ adapter = gitAdapter, picker }) {
  const config = useGitConfig()
  const [rootsText, setRootsText] = React.useState(() => effectiveRoots(getGitConfig()).join('; '))
  const [message, setMessage] = React.useState(null)
  const [dotfilesText, setDotfilesText] = React.useState(() => effectiveDotfiles(getGitConfig()))
  const [missing, setMissing] = React.useState(() => new Set())
  const [adding, setAdding] = React.useState(false)
  const addingRef = React.useRef(false)
  const checkRef = React.useRef(0)
  // Repositories found in the search folders, each with the name it's registered under (or null).
  const [found, setFound] = React.useState(null)
  const [listOpen, setListOpen] = React.useState(false)
  const scanRef = React.useRef(0)
  const available = adapter.isAvailable()
  const savedRoots = effectiveRoots(config)
  const checkKey = JSON.stringify([config.repos.map(r => r.path), savedRoots])
  const scanKey = JSON.stringify([savedRoots, config.repos])

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

  // Rescanned whenever the search folders or the registrations change, so the ticks follow the settings.
  React.useEffect(() => {
    if (!available) return
    const [roots, repos] = JSON.parse(scanKey)
    const id = ++scanRef.current
    if (!roots.length) { setFound([]); return }
    Promise.resolve()
      .then(() => adapter.discover(roots, repos))
      .then(list => { if (id === scanRef.current) setFound(list) })
      .catch(e => { if (id === scanRef.current) { setFound([]); setMessage({ ok: false, text: `Repository search failed: ${cleanError(e)}` }) } })
  }, [adapter, available, scanKey])

  if (!available) return null
  const locked = config.unsupported != null
  const missingRoots = savedRoots.filter(r => missing.has(r))

  // One registration at a time, from the folder picker or the discovered list.
  const register = async pick => {
    if (locked || addingRef.current) return
    addingRef.current = true
    setAdding(true)
    try {
      const dir = await pick()
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
  const addRepo = () => register(() => picker.pickDirectory())
  const unregister = name => { setMessage(null); setGitConfig(unregisterRepo(getGitConfig(), name)) }
  const toggleFound = r => (r.registeredAs ? unregister(r.registeredAs) : register(async () => r.path))
  const saveDotfiles = async () => {
    if (locked) return
    const folder = dotfilesText.trim()
    if (!folder) { setGitConfig({ dotfiles: '' }); setMessage({ ok: true, text: 'DotFiles shortcuts turned off' }); return }
    const { roots, network } = parseRoots(folder)
    if (network.length) { setMessage({ ok: false, text: `Network (UNC) paths aren't supported: ${folder}` }); return }
    if (roots.length !== 1 || folder.includes(';')) { setMessage({ ok: false, text: `Use one absolute folder: ${folder}` }); return }
    setGitConfig({ dotfiles: folder })
    let shortcuts = null
    try { shortcuts = parseShellAliases(await adapter.shellAliases(folder)).length } catch { /* reported below */ }
    setMessage(shortcuts ? { ok: true, text: `Saved · ${shortcuts} git shortcut${shortcuts === 1 ? '' : 's'} found` } : { ok: false, text: `Saved, but no git shortcuts were found in ${folder}/pwsh/profile.d` })
  }
  const saveRoots = async () => {
    if (locked) return
    const { roots, invalid, network } = parseRoots(rootsText)
    if (network.length) { setMessage({ ok: false, text: `Network (UNC) paths aren't supported: ${network.join(', ')}` }); return }
    if (invalid.length) { setMessage({ ok: false, text: `Use absolute folders: ${invalid.join(', ')}` }); return }
    setGitConfig({ roots })
    if (!roots.length) { setMessage({ ok: true, text: 'No search folders · add repositories by folder below' }); return }
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
      <VsRow title="Search folders" desc="Folders whose immediate subfolders are listed under Discovered repositories. Separate with ; — leave empty to turn discovery off.">
        <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="Search folders" style={inputStyle} value={rootsText} disabled={locked} onChange={e => setRootsText(e.target.value)} />
          <button className="btn sm" disabled={locked} onClick={saveRoots}>Save folders</button>
        </div>
        {missingRoots.length > 0 && <div style={{ marginTop: 4, color: 'var(--danger)' }}>{`Not found: ${missingRoots.join(', ')}`}</div>}
      </VsRow>
      <VsRow title="DotFiles folder" desc="Your one-line PowerShell git shortcuts there (pwsh/profile.d, e.g. ga, uncommit) work in the Git Workspace command line. Leave empty to turn them off.">
        <div style={{ display: 'flex', gap: 6 }}>
          <input aria-label="DotFiles folder" style={inputStyle} value={dotfilesText} disabled={locked} onChange={e => setDotfilesText(e.target.value)} />
          <button className="btn sm" disabled={locked} onClick={saveDotfiles}>Save folder</button>
        </div>
      </VsRow>
      <VsRow title="Repositories" desc="Only registered repositories appear in the Git Workspace. Removing one only unregisters it; its files stay in place.">
        <div style={{ display: 'grid', gap: 4 }}>
          {savedRoots.length === 0
            ? <span style={{ color: 'var(--text-muted)' }}>Set a search folder to list repositories found there.</span>
            : (
              <div>
                <button className="btn sm ghost" aria-expanded={listOpen} aria-controls="git-discovered-repos" disabled={found == null}
                  onClick={() => setListOpen(o => !o)}>
                  {found == null ? 'Searching for repositories…' : `Discovered repositories (${found.length})`}
                  <span aria-hidden="true" style={{ marginLeft: 6 }}>{listOpen ? '▴' : '▾'}</span>
                </button>
                {listOpen && found && (
                  <div id="git-discovered-repos" role="group" aria-label="Discovered repositories"
                    style={{ marginTop: 4, maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', display: 'grid', gap: 2 }}>
                    {found.length === 0 && <span style={{ color: 'var(--text-muted)' }}>{`No repositories found in ${savedRoots.join('; ')}.`}</span>}
                    {found.map(r => (
                      <label key={r.path} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                        <input type="checkbox" aria-label={r.name} checked={!!r.registeredAs} disabled={locked || adding} onChange={() => toggleFound(r)} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {r.registeredAs ?? r.name} <span style={{ color: 'var(--text-muted)' }}>{r.path}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          {config.repos.length === 0 && <span style={{ color: 'var(--text-muted)' }}>None registered.</span>}
          {config.repos.map(r => (
            <div key={r.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>
                {r.name} <span style={{ color: 'var(--text-muted)' }}>{r.path}</span>
                {missing.has(r.path) && <> · <span style={{ color: 'var(--danger)' }}>not found</span></>}
              </span>
              <button className="btn sm ghost" aria-label={`Remove ${r.name}`} disabled={locked} onClick={() => unregister(r.name)}>Remove</button>
            </div>
          ))}
          <div><button className="btn sm" disabled={locked || adding} onClick={addRepo}>Add repository…</button></div>
        </div>
      </VsRow>
      {message && <div role="status" style={{ padding: '6px 12px', color: message.ok ? 'var(--success)' : 'var(--danger)' }}>{message.text}</div>}
    </VsCard>
  )
}
