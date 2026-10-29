import React from 'react'
import { listGithubBranches, createGithubBranch, deleteGithubBranch } from '@nexusmd/core'

/**
 * A GitHub repository's branches: list with default / protected badges, a form to create one from
 * another branch, and Delete on plain branches. `onBranchesChanged` gets the list after each load.
 */
export function GithubBranches({ repo, client, refreshKey, confirm = window.confirm, onBranchesChanged }) {
  const [loaded, setLoaded] = React.useState({ repo: null, client: null, list: [] })
  const [error, setError] = React.useState('')
  const [from, setFrom] = React.useState('')
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const busyRef = React.useRef(false)
  const [reloads, setReloads] = React.useState(0)
  const notify = React.useRef(onBranchesChanged)
  notify.current = onBranchesChanged

  // Rows belong to the repository they were loaded for; another repository starts empty.
  const branches = loaded.repo === repo && loaded.client === client ? loaded.list : []
  React.useEffect(() => { setFrom(''); setName(''); setError('') }, [repo, client])

  React.useEffect(() => {
    if (!client) return undefined
    let live = true
    Promise.resolve().then(() => listGithubBranches(client, repo)).then(
      list => {
        if (!live) return
        setLoaded({ repo, client, list })
        setError('')
        notify.current?.(list)
      },
      e => { if (live) setError(e?.message || String(e)) },
    )
    return () => { live = false }
  }, [client, repo, refreshKey, reloads])

  const defaultName = branches.find(b => b.isDefault)?.name ?? branches[0]?.name ?? ''
  const source = branches.some(b => b.name === from) ? from : defaultName

  const run = async action => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action()
      setError('')
      setReloads(n => n + 1)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  const create = e => {
    e.preventDefault()
    if (busyRef.current) return
    const next = name.trim()
    if (!next || !source) return
    run(async () => { await createGithubBranch(client, repo, { name: next, from: source }); setName('') })
  }
  const remove = b => {
    if (busyRef.current || !confirm(`Delete branch ${b.name} on GitHub?`)) return
    run(() => deleteGithubBranch(client, repo, b.name))
  }

  return (
    <div className="nx-gw-gh-branches">
      <form className="nx-gw-gh-newbranch" onSubmit={create}>
        <strong>New branch</strong>
        <select aria-label="From branch" value={source} onChange={e => setFrom(e.target.value)}>
          {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
        </select>
        <input aria-label="Branch name" placeholder="feature/name" value={name} onChange={e => setName(e.target.value)} />
        <button type="submit" className="btn sm" disabled={busy || !name.trim() || !source}>Create</button>
      </form>
      {error && <div role="alert" className="nx-gw-dhead-error">{error}</div>}
      <ul aria-label="GitHub branches" className="nx-gw-gh-branch-list">
        {branches.map(b => (
          <li key={b.name} aria-label={b.name} className="nx-gw-gh-branch">
            <span className="nx-gw-row-title">{b.name}</span>
            {b.isDefault && <span className="nx-badge">default</span>}
            {b.protected && <span className="nx-badge">protected</span>}
            {!b.isDefault && !b.protected && (
              <button type="button" className="btn sm ghost" disabled={busy} onClick={() => remove(b)}>Delete</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
