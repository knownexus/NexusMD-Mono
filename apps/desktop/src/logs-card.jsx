import React from 'react'
import { VsCard, VsRow, Icon } from '@nexusmd/ui'
import { parseLog, filterEntries, LOG_LEVELS, NO_AREA } from './log-parse.js'

const LEVEL_COLOR = {
  error:   'var(--danger)',
  warn:    'var(--warning)',
  info:    'var(--text)',
  verbose: 'var(--text-muted)',
  debug:   'var(--text-muted)',
  silly:   'var(--text-muted)',
  '':      'var(--text-subtle)',
}

const controlStyle = {
  padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface-2)', outline: 'none', fontSize: 13, color: 'var(--text)',
}

export default function LogsCard() {
  const [logs, setLogs] = React.useState([])
  const [selectedDate, setSelectedDate] = React.useState(null)
  const [content, setContent] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [contentLoading, setContentLoading] = React.useState(false)

  const [activeLevels, setActiveLevels] = React.useState(() => new Set(LOG_LEVELS))
  const [areaFilter, setAreaFilter] = React.useState(null)
  const [search, setSearch] = React.useState('')
  const [expanded, setExpanded] = React.useState(() => new Set())

  const loadLogs = React.useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI?.logs?.list?.()
      setLogs(list || [])
      if (list?.length > 0 && !selectedDate) setSelectedDate(list[0].date)
    } catch (err) {
      console.error('[LogsCard] Failed to list logs:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  const loadContent = React.useCallback(async (date) => {
    if (!date) return
    setContentLoading(true)
    try {
      const text = await window.electronAPI?.logs?.read?.(date)
      setContent(text || '')
    } catch (err) {
      console.error('[LogsCard] Failed to read log:', err)
      setContent('')
    } finally {
      setContentLoading(false)
    }
  }, [])

  React.useEffect(() => { loadLogs() }, [loadLogs])
  React.useEffect(() => { if (selectedDate) loadContent(selectedDate) }, [selectedDate, loadContent])

  const entries = React.useMemo(() => parseLog(content), [content])

  const availableLevels = React.useMemo(
    () => LOG_LEVELS.filter(l => entries.some(e => e.level === l)),
    [entries],
  )
  const availableAreas = React.useMemo(() => {
    const set = new Set()
    let hasNull = false
    for (const e of entries) { if (e.area == null) hasNull = true; else set.add(e.area) }
    const arr = [...set].sort((a, b) => a.localeCompare(b))
    if (hasNull) arr.push(NO_AREA)
    return arr
  }, [entries])

  // New file → reset filters to "all", keeping every entry visible by default.
  React.useEffect(() => {
    setActiveLevels(new Set(availableLevels))
    setAreaFilter(null)
    setSearch('')
    setExpanded(new Set())
  }, [entries, availableLevels])

  const filtered = React.useMemo(
    () => filterEntries(entries, { levels: activeLevels, area: areaFilter, search }),
    [entries, activeLevels, areaFilter, search],
  )

  const toggleLevel = (lvl) => setActiveLevels(prev => {
    const next = new Set(prev)
    if (next.has(lvl)) next.delete(lvl); else next.add(lvl)
    return next
  })
  const toggleExpand = (id) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const deleteLog = async () => {
    if (!selectedDate || !window.confirm(`Delete log for ${selectedDate}?`)) return
    try {
      const success = await window.electronAPI?.logs?.delete?.(selectedDate)
      if (success) { setContent(''); setSelectedDate(null); loadLogs() }
    } catch (err) {
      console.error('[LogsCard] Failed to delete log:', err)
    }
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <VsCard title="Application Logs" icon="log">
      <VsRow title="Available logs" desc={`${logs.length} log file${logs.length !== 1 ? 's' : ''} available`}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={loadLogs} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </VsRow>

      {logs.length > 0 ? (
        <>
          <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>Select date:</label>
            <select aria-label="Select date" value={selectedDate || ''}
              onChange={(e) => setSelectedDate(e.target.value)} style={controlStyle}>
              {logs.map((log) => (
                <option key={log.date} value={log.date}>{log.date} ({formatSize(log.size)})</option>
              ))}
            </select>
          </div>

          {selectedDate && (
            <>
              {/* Filters */}
              <div style={{ padding: '4px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {availableLevels.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {availableLevels.map(l => (
                      <button key={l} className="btn sm" onClick={() => toggleLevel(l)}
                        aria-pressed={activeLevels.has(l)}
                        style={{
                          textTransform: 'uppercase', fontSize: 10, fontWeight: 700,
                          borderColor: LEVEL_COLOR[l], color: LEVEL_COLOR[l],
                          opacity: activeLevels.has(l) ? 1 : 0.4,
                        }}>
                        {l}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <select aria-label="Filter by area" value={areaFilter || ''}
                    onChange={(e) => setAreaFilter(e.target.value || null)} style={controlStyle}>
                    <option value="">All areas</option>
                    {availableAreas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <input aria-label="Search logs" value={search} placeholder="Search…"
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ ...controlStyle, flex: 1, minWidth: 120 }} />
                </div>
              </div>

              {/* Entry list */}
              <div style={{ padding: '4px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  {contentLoading ? 'Loading…' : `Showing ${filtered.length} of ${entries.length} entries`}
                </div>
                <div style={{
                  height: 320, overflowY: 'auto', border: '1px solid var(--border)',
                  borderRadius: 6, background: 'var(--surface-2)', padding: '4px 8px',
                }}>
                  {filtered.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: 8 }}>
                      {entries.length === 0 ? 'No content.' : 'No entries match the current filters.'}
                    </div>
                  ) : filtered.map(e => {
                    const hasExtra = e.extraLines.length > 0
                    const isExp = expanded.has(e.id)
                    const color = LEVEL_COLOR[e.level] ?? 'var(--text)'
                    const time = e.ts.split(' ')[1] || e.ts
                    return (
                      <div key={e.id} style={{
                        borderBottom: '1px solid var(--border-subtle)', padding: '3px 0',
                        fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.5,
                      }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', cursor: hasExtra ? 'pointer' : 'default' }}
                          onClick={hasExtra ? () => toggleExpand(e.id) : undefined}>
                          <span style={{ width: 10, color: 'var(--text-subtle)', flexShrink: 0 }}>
                            {hasExtra ? (isExp ? '▾' : '▸') : ''}
                          </span>
                          <span style={{ color: 'var(--text-subtle)', whiteSpace: 'nowrap', flexShrink: 0 }}>{time}</span>
                          <span style={{ color, fontWeight: 700, textTransform: 'uppercase', width: 46, flexShrink: 0 }}>
                            {e.level || '—'}
                          </span>
                          {e.area && <span style={{ color: 'var(--accent)', flexShrink: 0 }}>[{e.area}]</span>}
                          <span style={{ color, flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.message}</span>
                        </div>
                        {hasExtra && isExp && (
                          <pre style={{
                            margin: '2px 0 4px 18px', color: 'var(--text-muted)',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11,
                          }}>{e.extraLines.join('\n')}</pre>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div style={{ padding: '8px 16px', display: 'flex', gap: 8 }}>
                <button className="btn sm ghost danger" onClick={deleteLog} disabled={contentLoading}>
                  <Icon name="trash" size={12} style={{ marginRight: 4 }} />
                  Delete log
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: 13 }}>
          No logs available yet. Logs will appear here once the app generates them.
        </div>
      )}
    </VsCard>
  )
}
