import React from 'react'
import { Icon } from '../icons.jsx'

const { useState, useEffect, useRef, useMemo } = React

// ── TagInput ──────────────────────────────────────────────────────────────────
// Ported from apps/app/src/app.jsx's TagInput. `knownTags` (for autocomplete)
// is now an explicit prop instead of reading the HelmData.WORK_ITEMS global,
// so this can run on any platform via useNexusData().data.WORK_ITEMS.
export function TagInput({ value, onChange, knownTags = [], style }) {
  const selected = (value || '').split(';').map(t => t.trim()).filter(Boolean)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const inputRef = useRef(null)

  const filtered = knownTags.filter(t =>
    !selected.includes(t) && (!query || t.toLowerCase().includes(query.toLowerCase()))
  )
  const canCreate = query.trim() && !knownTags.some(t => t.toLowerCase() === query.trim().toLowerCase()) && !selected.includes(query.trim())

  const add = (tag) => {
    const tr = tag.trim()
    if (!tr || selected.includes(tr)) return
    onChange([...selected, tr].join('; '))
    setQuery('')
    inputRef.current?.focus()
  }

  const remove = (tag) => {
    onChange(selected.filter(t => t !== tag).join('; '))
  }

  const onKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && query.trim()) {
      e.preventDefault()
      add(query.trim())
      setOpen(false)
    } else if (e.key === 'Backspace' && !query && selected.length) {
      remove(selected[selected.length - 1])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const baseStyle = {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    minHeight: 32, padding: '3px 8px', cursor: 'text',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
    ...(style || {}),
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <div style={baseStyle} onClick={() => { setOpen(true); inputRef.current?.focus() }}>
        {selected.map(t => (
          <span key={t} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'var(--accent-soft, rgba(99,102,241,0.12))', color: 'var(--accent, #6366f1)',
            borderRadius: 5, padding: '1px 6px', fontSize: 11.5, fontWeight: 500, lineHeight: '18px',
          }}>
            {t}
            <span onMouseDown={e => { e.stopPropagation(); e.preventDefault(); remove(t) }}
              style={{ cursor: 'pointer', opacity: 0.6, fontSize: 13, lineHeight: 1 }}>×</span>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={selected.length ? '' : 'Add tags…'}
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--sans)',
            flex: '1 1 80px', minWidth: 80, height: 24, padding: 0,
          }}
        />
      </div>
      {open && (filtered.length > 0 || canCreate) && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, marginTop: 2,
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
          boxShadow: 'var(--shadow-pop)', maxHeight: 180, overflowY: 'auto',
        }}>
          {filtered.map(t => (
            <div key={t} onMouseDown={e => { e.preventDefault(); add(t); setOpen(false) }}
              style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: 'var(--text)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = '' }}>
              {t}
            </div>
          ))}
          {canCreate && (
            <div onMouseDown={e => { e.preventDefault(); add(query.trim()); setOpen(false) }}
              style={{ padding: '6px 12px', fontSize: 12.5, cursor: 'pointer', color: 'var(--accent, #6366f1)', borderTop: filtered.length ? '1px solid var(--border)' : 'none' }}>
              + Create "{query.trim()}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── AreaTreePicker ────────────────────────────────────────────────────────────
// Multi-select tree picker. value is a semicolon-separated string of paths.
// Ported from apps/app/src/app.jsx's AreaTreePicker; `areas` is now an
// explicit prop (from useProjectAreas()) instead of HelmData.PROJECT_AREAS.
export function AreaTreePicker({ value, onChange, areas = [], compact = false }) {
  const selected = useMemo(
    () => new Set((value || '').split(';').map(s => s.trim()).filter(Boolean)),
    [value]
  )

  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set(areas.map(n => n.id)))
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggleExpand = (e, id) => {
    e.stopPropagation(); e.preventDefault()
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const togglePath = (path) => {
    const next = new Set(selected)
    next.has(path) ? next.delete(path) : next.add(path)
    onChange([...next].join('; '))
  }

  const removePath = (path) => {
    const next = new Set(selected)
    next.delete(path)
    onChange([...next].join('; '))
  }

  const renderNodes = (nodes, prefix) => nodes.map(n => {
    const path = prefix ? `${prefix}\\${n.name}` : n.name
    const children = n.children || []
    const items = n.items || []
    const hasContent = children.length > 0 || items.length > 0
    const isExpanded = expanded.has(n.id)
    const isSelected = selected.has(path)
    const depth = prefix ? prefix.split('\\').length : 0

    return (
      <React.Fragment key={n.id}>
        <button
          onMouseDown={e => { e.preventDefault(); togglePath(path) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, width: '100%',
            textAlign: 'left', border: 'none', borderRadius: 6,
            background: isSelected ? 'var(--accent-soft)' : 'transparent',
            color: isSelected ? 'var(--accent)' : depth === 0 ? 'var(--text)' : 'var(--text-muted)',
            fontWeight: depth === 0 ? 600 : 500,
            padding: `5px 8px 5px ${8 + depth * 14}px`,
            cursor: 'pointer', fontSize: 12.5, fontFamily: 'var(--sans)',
          }}
          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--surface-2)' }}
          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
        >
          <span
            style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-subtle)' }}
            onMouseDown={e => hasContent && toggleExpand(e, n.id)}
          >
            {hasContent ? <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={10}/> : null}
          </span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
          {isSelected && <Icon name="check" size={10} style={{ color: 'var(--accent)', flexShrink: 0 }}/>}
        </button>
        {hasContent && isExpanded && (
          <React.Fragment>
            {renderNodes(children, path)}
            {items.map((item, i) => {
              const itemPath = `${path}\\${item}`
              const itemSel = selected.has(itemPath)
              const itemDepth = depth + 1
              return (
                <button key={i}
                  onMouseDown={e => { e.preventDefault(); togglePath(itemPath) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                    textAlign: 'left', border: 'none', borderRadius: 6,
                    background: itemSel ? 'var(--accent-soft)' : 'transparent',
                    color: itemSel ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: 400,
                    padding: `4px 8px 4px ${8 + itemDepth * 14}px`,
                    cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)',
                  }}
                  onMouseEnter={e => { if (!itemSel) e.currentTarget.style.background = 'var(--surface-2)' }}
                  onMouseLeave={e => { if (!itemSel) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ width: 14, flexShrink: 0 }}/>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item}</span>
                  {itemSel && <Icon name="check" size={10} style={{ color: 'var(--accent)', flexShrink: 0 }}/>}
                </button>
              )
            })}
          </React.Fragment>
        )}
      </React.Fragment>
    )
  })

  const selectedArr = [...selected]

  const triggerBase = compact ? {
    background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6,
    padding: '3px 6px', fontFamily: 'var(--sans)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
    width: '100%', boxSizing: 'border-box', minHeight: 28, textAlign: 'left',
  } : {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px',
    display: 'flex', alignItems: 'center', flexWrap: 'wrap',
    gap: 4, cursor: 'pointer', minHeight: 36, width: '100%', boxSizing: 'border-box',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(v => !v)} style={triggerBase}>
        {selectedArr.length > 0
          ? selectedArr.map(path => {
              const label = path.split('\\').pop()
              return (
                <span key={path} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  borderRadius: 5, padding: '1px 6px', fontSize: 11.5, fontWeight: 500, lineHeight: '18px',
                }}>
                  {label}
                  <span
                    onMouseDown={e => { e.stopPropagation(); e.preventDefault(); removePath(path) }}
                    style={{ cursor: 'pointer', opacity: 0.6, fontSize: 13, lineHeight: 1 }}
                  >×</span>
                </span>
              )
            })
          : <span style={{ fontSize: 13, color: 'var(--text-subtle)', flex: 1 }}>— None —</span>
        }
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={11} style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text-subtle)' }}/>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: 260,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, boxShadow: 'var(--shadow-pop)',
          maxHeight: 280, overflowY: 'auto', padding: 4, zIndex: 300,
        }}>
          {selectedArr.length > 0 && (
            <button
              onMouseDown={e => { e.preventDefault(); onChange('') }}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, width: '100%', border: 'none', borderRadius: 6,
                background: 'transparent', color: 'var(--danger)',
                padding: '5px 8px', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--sans)', marginBottom: 2,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger-soft)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ width: 14 }}/>
              Clear all
            </button>
          )}
          {renderNodes(areas, '')}
        </div>
      )}
    </div>
  )
}
