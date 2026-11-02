import React from 'react'
import { formatDateTime, formatSize } from '@nexusmd/core'
import { Avatar, ProjectChip } from '../app-components.jsx'
import { Icon } from '../icons.jsx'
import { toast } from '../toast.jsx'
import { useNexusData } from '../data-context.jsx'

const ERROR_STATUSES = ['failed', 'partial', 'cancelled']

export function BuildDetail({ build }) {
  const { buildSource, buildArtifacts } = useNexusData()
  const showErrors = ERROR_STATUSES.includes(build.status)
  const [loading, setLoading] = React.useState(showErrors)
  const [error, setError] = React.useState(null)
  const [failedRecords, setFailedRecords] = React.useState(null)

  React.useEffect(() => {
    if (!showErrors) return
    let cancelled = false
    setLoading(true); setError(null)
    buildSource.loadTimeline(build.projectName || build.project, build.id, build)
      .then(res => { if (!cancelled) setFailedRecords(res?.failedRecords ?? []) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [showErrors, build.project, build.id, buildSource])

  return (
    <div>
      <div className="drawer-section">
        <MetaRow label="Project"><ProjectChip id={build.project}/></MetaRow>
        <MetaRow label="Branch"><span className="mono">{build.branch}</span></MetaRow>
        <MetaRow label="Commit"><span className="mono">{build.commit}</span></MetaRow>
        <MetaRow label="Triggered by">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Avatar who={build.actor} size="xs"/> {build.actor}
          </span>
        </MetaRow>
        <MetaRow label="Reason">{build.reason || '—'}</MetaRow>
        <MetaRow label="Duration">{build.duration}</MetaRow>
        <MetaRow label="Finished">{build.finishTime ? formatDateTime(build.finishTime) : '—'}</MetaRow>
      </div>

      {buildArtifacts && <BuildArtifacts build={build} source={buildArtifacts} />}

      {showErrors && (
        <div className="drawer-section">
          <h4 style={SECTION_TITLE}>Errors</h4>
          {loading && <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading errors…</div>}
          {!loading && error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          {!loading && !error && failedRecords?.length === 0 && (
            <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>No failure details available.</div>
          )}
          {!loading && !error && failedRecords?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {failedRecords.map((r, i) => (
                <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: r.messages.length ? 4 : 0 }}>
                    <span className="pill" style={{ fontSize: 10 }}>{r.type}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.name}</span>
                  </div>
                  {r.messages.map((m, j) => (
                    <div key={j} className="mono" style={{ fontSize: 11.5, color: 'var(--danger)' }}>{m}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const SECTION_TITLE = { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }

// The build's artifacts, each with a Download button. Shown only where the platform supplies
// `buildArtifacts` (desktop saves through its main process; web has none).
function BuildArtifacts({ build, source }) {
  const [items, setItems] = React.useState(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState('')

  React.useEffect(() => {
    let live = true
    setItems(null); setError(''); setBusy('')
    source.list(build)
      .then(r => { if (live) setItems(r || []) })
      .catch(e => { if (live) { setItems([]); setError(e?.message || 'Could not load the artifacts.') } })
    return () => { live = false }
  }, [build.id, build.source, source]) // eslint-disable-line react-hooks/exhaustive-deps

  const download = async (item) => {
    setBusy(item.url)
    try {
      const r = await source.save(item)
      if (r?.saved) toast(`Saved ${item.filename}${r.bytes ? ` (${formatSize(r.bytes)})` : ''}.`, 'success')
    } catch (e) {
      toast(e?.message || 'Download failed.', 'error')
    }
    setBusy('')
  }

  const muted = { color: 'var(--text-subtle)', fontSize: 13 }
  return (
    <div className="drawer-section">
      <h4 style={SECTION_TITLE}>Artifacts</h4>
      {items === null && <div style={muted}>Loading artifacts…</div>}
      {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
      {items && !error && items.length === 0 && <div style={muted}>This build published no artifacts.</div>}
      {items && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map(item => (
            <div key={item.url} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{item.expired ? 'Expired' : (formatSize(item.size) || 'Zip')}</div>
              </div>
              <button type="button" className="btn sm" disabled={item.expired || busy === item.url} onClick={() => download(item)}>
                <Icon name="download" size={12}/> {busy === item.url ? 'Saving…' : 'Download'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MetaRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
      <span style={{ width: 100, flexShrink: 0, color: 'var(--text-muted)' }}>{label}</span>
      <span>{children}</span>
    </div>
  )
}
