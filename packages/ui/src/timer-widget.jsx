import React from 'react'
import { formatClock, formatDuration } from '@nexusmd/core'
import { useTimer } from './use-timer.js'
import { Icon } from './icons.jsx'

const { useRef } = React

/**
 * Standalone stopwatch / countdown widget built on useTimer.
 * @param {{ mode?: 'stopwatch'|'countdown', durationMs?: number|null,
 *           persistKey?: string|null, compact?: boolean,
 *           onExpire?: () => void,
 *           onStop?: (elapsedMs: number, meta: { firstStartedAt: number|null, stoppedAt: number }) => void }} props
 */
export function TimerWidget({ mode = 'stopwatch', durationMs = null, persistKey = null, compact = false, onExpire, onStop }) {
  const t = useTimer({ mode, durationMs, persistKey, onExpire })
  const firstStartedAt = useRef(null)

  const display = mode === 'countdown' ? t.remainingMs : t.elapsedMs
  const idle = t.state.status === 'idle'
  const running = t.state.status === 'running'
  const paused = t.state.status === 'paused'

  const handleStart = () => {
    if (firstStartedAt.current == null) firstStartedAt.current = Date.now()
    t.start()
  }
  const handleStop = () => {
    const elapsed = t.elapsedMs
    const meta = { firstStartedAt: firstStartedAt.current, stoppedAt: Date.now() }
    t.stop()
    onStop?.(elapsed, meta)
  }
  const handleReset = () => { firstStartedAt.current = null; t.reset() }

  const wrap = {
    display: 'inline-flex', flexDirection: 'column', gap: 10,
    padding: compact ? 10 : 16, border: '1px solid var(--border)',
    borderRadius: 12, background: 'var(--surface)', minWidth: compact ? 160 : 200,
  }
  const clockStyle = {
    fontFamily: 'var(--mono, monospace)', fontVariantNumeric: 'tabular-nums',
    fontSize: compact ? 22 : 32, fontWeight: 600, color: 'var(--text)', letterSpacing: 1,
  }

  return (
    <div style={wrap} data-testid="timer-widget">
      <div style={clockStyle} data-testid="timer-clock">{formatClock(display)}</div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(idle || paused) && (
          <button className="btn primary sm" onClick={handleStart}>
            <Icon name="play" size={12}/> {paused ? 'Resume' : 'Start'}
          </button>
        )}
        {running && (
          <button className="btn sm" onClick={t.pause}>
            <Icon name="pause" size={12}/> Pause
          </button>
        )}
        {running && (
          <button className="btn ghost sm" onClick={t.lap}>
            <Icon name="flag" size={12}/> Lap
          </button>
        )}
        {(running || paused) && (
          <button className="btn ghost sm" onClick={handleStop}>
            <Icon name="x" size={12}/> Stop
          </button>
        )}
        {(paused || t.state.status === 'done') && (
          <button className="btn ghost sm" onClick={handleReset}>
            <Icon name="refresh" size={12}/> Reset
          </button>
        )}
      </div>

      {t.laps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--text-muted)' }}>
          {t.laps.map((ms, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Lap {i + 1}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatClock(ms)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
