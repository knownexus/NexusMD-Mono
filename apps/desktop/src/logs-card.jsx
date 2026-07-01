import React from 'react'
import { VsCard, VsRow, Icon } from '@nexusmd/ui'

export default function LogsCard() {
  const [logs, setLogs] = React.useState([])
  const [selectedDate, setSelectedDate] = React.useState(null)
  const [content, setContent] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [contentLoading, setContentLoading] = React.useState(false)

  // Load list of log files
  const loadLogs = React.useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.electronAPI?.logs?.list?.()
      setLogs(list || [])
      if (list?.length > 0 && !selectedDate) {
        setSelectedDate(list[0].date)
      }
    } catch (err) {
      console.error('[LogsCard] Failed to list logs:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  // Load content of selected log
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

  // Load logs on mount
  React.useEffect(() => {
    loadLogs()
  }, [loadLogs])

  // Load content when selected date changes
  React.useEffect(() => {
    if (selectedDate) {
      loadContent(selectedDate)
    }
  }, [selectedDate, loadContent])

  const deleteLog = async () => {
    if (!selectedDate || !window.confirm(`Delete log for ${selectedDate}?`)) return
    try {
      const success = await window.electronAPI?.logs?.delete?.(selectedDate)
      if (success) {
        setContent('')
        setSelectedDate(null)
        loadLogs()
      }
    } catch (err) {
      console.error('[LogsCard] Failed to delete log:', err)
    }
  }

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const textareaStyle = {
    width: '100%',
    height: 300,
    padding: '10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface-2)',
    outline: 'none',
    fontSize: 11,
    fontFamily: 'var(--mono)',
    color: 'var(--text)',
    resize: 'vertical',
    boxSizing: 'border-box',
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
            <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>
              Select date:
            </label>
            <select
              value={selectedDate || ''}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                padding: '7px 10px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                outline: 'none',
                fontSize: 13,
                color: 'var(--text)',
              }}
            >
              {logs.map((log) => (
                <option key={log.date} value={log.date}>
                  {log.date} ({formatSize(log.size)})
                </option>
              ))}
            </select>
          </div>

          {selectedDate && (
            <>
              <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Log contents:
                </label>
                <textarea
                  value={content}
                  readOnly
                  style={textareaStyle}
                  placeholder={contentLoading ? 'Loading…' : 'No content'}
                />
              </div>

              <div style={{ padding: '8px 16px', display: 'flex', gap: 8 }}>
                <button
                  className="btn sm ghost danger"
                  onClick={deleteLog}
                  disabled={contentLoading}
                >
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
