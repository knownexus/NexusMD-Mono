import React from 'react'
import { Icon, CardFrame, SettField } from '@nexusmd/ui'
import { getAdoConfig, saveAdoConfig, createAdoHttpAdapter } from './ado-client.js'
import { settInputStyle } from './form-style.js'

export function AdoConnectionCard({ onRefreshData }) {
  const [org, setOrg]           = React.useState('')
  const [pat, setPat]           = React.useState('')
  const [projects, setProjects] = React.useState('')
  const [status, setStatus]     = React.useState('')
  const [saving, setSaving]     = React.useState(false)
  const [discovering, setDiscovering] = React.useState(false)
  const [workItems, setWorkItems] = React.useState(true)

  React.useEffect(() => {
    const c = getAdoConfig()
    setOrg(c.org || '')
    setProjects((c.projects || []).join(', '))
    setWorkItems(c.workItems !== false)
  }, [])

  const save = async () => {
    setSaving(true)
    setStatus('Saving…')
    try {
      const projectList = projects.split(/[,\n]+/).map(p => p.trim()).filter(Boolean)
      saveAdoConfig({
        org: org.trim(),
        ...(pat.trim() ? { pat: pat.trim() } : {}),
        projects: projectList,
        workItems,
      })
      setStatus('Saved! Loading data…')
      setPat('')
      onRefreshData?.().catch(() => {})
      setTimeout(() => setStatus(''), 3000)
    } catch (e) {
      setStatus('Error: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const discoverProjects = async () => {
    const currentOrg = org.trim()
    const currentPat = pat.trim() || getAdoConfig().pat
    if (!currentOrg || !currentPat) { setStatus('Enter org and PAT first.'); return }
    setDiscovering(true)
    setStatus('Discovering…')
    try {
      saveAdoConfig({ org: currentOrg, pat: currentPat })
      const adapter = createAdoHttpAdapter()
      const res = await adapter.fetch('_apis/projects?api-version=7.0')
      const j   = await res.json()
      const names = (j.value || []).map(p => p.name).filter(Boolean)
      if (!names.length) { setStatus('No projects returned.'); return }
      setProjects(names.join(', '))
      setStatus(`Discovered ${names.length} project${names.length === 1 ? '' : 's'}.`)
    } catch (e) {
      setStatus('Error: ' + e.message)
    } finally {
      setDiscovering(false)
    }
  }

  const isError = status.startsWith('Error')

  return (
    <CardFrame title="Azure DevOps Connection" icon={<Icon name="settings" size={16} />}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={workItems} onChange={e => setWorkItems(e.target.checked)} />
          Load Azure DevOps work items
        </label>
        {!workItems && (
          <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: -8 }}>
            Pull requests, builds and tests still come from Azure DevOps.
          </div>
        )}
        <SettField label="Organisation" hint="The subdomain from dev.azure.com/your-org">
          <input value={org} onChange={e => setOrg(e.target.value)}
            placeholder="your-org-name" style={settInputStyle} />
        </SettField>
        <SettField label="Personal Access Token" hint="Needs Work Items (Read & Write), Code (Read & Write), Build (Read & Execute), Test Management (Read), and Project and Team (Read) scopes. Leave blank to keep existing.">
          <input type="password" value={pat} onChange={e => setPat(e.target.value)}
            placeholder="Leave blank to keep existing PAT" style={settInputStyle} />
        </SettField>
        <SettField label="Projects" hint="Comma-separated project names.">
          <textarea value={projects} onChange={e => setProjects(e.target.value)}
            placeholder="Project1, Project2" rows={2}
            style={{ ...settInputStyle, resize: 'vertical', paddingTop: 8, paddingBottom: 8 }} />
        </SettField>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn sm ghost" onClick={discoverProjects} disabled={discovering || saving}>
            {discovering ? 'Discovering…' : 'Discover projects'}
          </button>
          <button className="btn primary" onClick={save} disabled={saving || discovering}>
            {saving ? 'Saving…' : 'Save & connect'}
          </button>
          {status && (
            <span style={{ fontSize: 12.5, color: isError ? 'var(--danger)' : 'var(--success)' }}>
              {status}
            </span>
          )}
        </div>
      </div>
    </CardFrame>
  )
}
