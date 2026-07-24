// documents-modal.jsx — generic multi-document picker (new/open/rename/
// delete), the same interaction model as MarkdownViewer's inline
// DocumentsModal, generalized via renderPreview/metaText render props so it
// isn't tied to markdown-specific content or rendering.
import React from 'react'
import { displayName } from './document-store.js'

const { useState } = React

export function DocumentsModal({ docs, currentDocId, hasUnsavedContent, onOpen, onNew, onDelete, onRename, onClose, renderPreview, metaText }) {
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [pendingOpenId, setPendingOpenId] = useState(null)

  const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt)

  function handleCardClick(doc) {
    if (doc.id === currentDocId) { onClose(); return }
    if (hasUnsavedContent) { setPendingOpenId(doc.id); return }
    onOpen(doc.id)
  }

  function startRename(e, doc) {
    e.stopPropagation()
    setRenamingId(doc.id)
    setRenameValue(doc.name ?? doc.autoName)
    setConfirmDeleteId(null)
  }

  function commitRename(id) {
    const val = renameValue.trim()
    const doc = docs.find(d => d.id === id)
    onRename(id, (doc && val === doc.autoName) ? null : (val || null))
    setRenamingId(null)
  }

  function startDelete(e, id) {
    e.stopPropagation()
    setConfirmDeleteId(id)
    setRenamingId(null)
  }

  const iconBtnStyle = {
    width: 26, height: 26, borderRadius: 4,
    border: '1px solid var(--border)', background: 'var(--surface)',
    color: 'var(--text-muted)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, padding: 0, flexShrink: 0,
  }

  return (
    <>
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          padding: '40px 16px', overflowY: 'auto',
        }}
        onClick={onClose}
      >
        <div
          style={{
            width: '100%', maxWidth: 880,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,.3)',
          }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Documents
              {docs.length > 0 && (
                <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>
                  ({docs.length})
                </span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={onNew}
                style={{
                  padding: '6px 14px', borderRadius: 6,
                  border: '1px solid var(--accent)', background: 'var(--accent)',
                  color: 'var(--accent-fg)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
              >+ New Document</button>
              <button
                onClick={onClose}
                style={{
                  ...iconBtnStyle, width: 30, height: 30,
                  fontSize: 18, color: 'var(--text-muted)', border: '1px solid var(--border)',
                }}
              >×</button>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            {docs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-subtle)', fontSize: 13 }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
                  style={{ display: 'block', margin: '0 auto 12px', opacity: .4 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <p>No saved documents yet.</p>
                <p style={{ marginTop: 4 }}>Start typing to create one.</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 16,
              }}>
                {sorted.map(doc => {
                  const isActive   = doc.id === currentDocId
                  const isRenaming = renamingId === doc.id
                  const isDeleting = confirmDeleteId === doc.id

                  return (
                    <div
                      key={doc.id}
                      onClick={() => handleCardClick(doc)}
                      style={{
                        position: 'relative', borderRadius: 8, overflow: 'hidden',
                        border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                        background: 'var(--bg)', cursor: 'pointer',
                        transition: 'border-color .15s',
                      }}
                    >
                      <div
                        style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4, zIndex: 2 }}
                        onClick={e => e.stopPropagation()}
                      >
                        {isDeleting ? (
                          <>
                            <button
                              style={{ ...iconBtnStyle, color: 'var(--danger)', borderColor: 'var(--danger)', padding: '0 8px', width: 'auto', gap: 4, fontSize: 11 }}
                              onClick={e => { e.stopPropagation(); onDelete(doc.id); setConfirmDeleteId(null) }}
                            >Delete?</button>
                            <button
                              style={iconBtnStyle}
                              onClick={e => { e.stopPropagation(); setConfirmDeleteId(null) }}
                            >✕</button>
                          </>
                        ) : (
                          <>
                            <button style={iconBtnStyle} title="Rename" onClick={e => startRename(e, doc)}>
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <path d="M11 2l3 3L5 14H2v-3L11 2z"/>
                              </svg>
                            </button>
                            <button style={{ ...iconBtnStyle, color: 'var(--danger)' }} title="Delete" onClick={e => startDelete(e, doc.id)}>
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <polyline points="2 4 14 4"/>
                                <path d="M5 4V2h6v2M6 7v5M10 7v5"/>
                                <path d="M3 4l1 10h8l1-10"/>
                              </svg>
                            </button>
                          </>
                        )}
                      </div>

                      <div style={{
                        height: 130, overflow: 'hidden', position: 'relative',
                        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
                      }}>
                        {renderPreview(doc)}
                      </div>

                      <div style={{ padding: '10px 12px 12px' }}>
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => commitRename(doc.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); commitRename(doc.id) }
                              if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null) }
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              width: '100%', border: '1px solid var(--accent)',
                              borderRadius: 4, padding: '3px 7px',
                              background: 'var(--surface)', color: 'var(--text)',
                              fontSize: 12, fontWeight: 600, outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        ) : (
                          <div style={{
                            fontSize: 12, fontWeight: 600, color: 'var(--text)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            paddingRight: 58,
                          }}>
                            {displayName(doc)}
                          </div>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                          {metaText(doc)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {pendingOpenId !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 400,
          background: 'rgba(0,0,0,.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '28px 32px', maxWidth: 360, width: '100%',
            margin: '0 16px', textAlign: 'center',
            boxShadow: '0 8px 30px rgba(0,0,0,.25)',
          }}>
            <p style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              You have unsaved content. Open this document anyway?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                style={{
                  padding: '7px 18px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                }}
                onClick={() => setPendingOpenId(null)}
              >Cancel</button>
              <button
                style={{
                  padding: '7px 18px', borderRadius: 6,
                  border: 'none', background: 'var(--accent)',
                  color: 'var(--accent-fg)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
                onClick={() => { onOpen(pendingOpenId); setPendingOpenId(null) }}
              >Open anyway</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
