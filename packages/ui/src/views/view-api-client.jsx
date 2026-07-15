import React from 'react'
// view-api-client.jsx — general-purpose API client (Bruno/Postman-style).
// Desktop-only for now: useApiClient().available is false until the host wires
// real `file`/`scriptRunner` adapters (see api-client-context.jsx), which today
// only apps/desktop does.
//
// Multiple collections can be loaded side by side, each its own collapsible
// accordion in the sidebar (loadedDirs/collapsedDirs are persisted so the set
// of open collections survives a restart). Only one request is edited at a
// time — activeDir/selectedRefId point at whichever request is open, mirroring
// how Postman/Bruno keep a single active editor over a multi-collection tree.

import { Icon } from '../icons.jsx'
import { usePersisted } from '../app-components.jsx'
import { useApiClient } from '../api-client-context.jsx'
import { JsonPretty } from '../json-pretty.jsx'
import {
  loadCollection, createCollection, writeCollectionMeta, writeRequest,
  addTreeNode, buildRunEntries,
  resolveEnvironment, executeRequest, runCollection, importPostmanCollection,
  appendHistoryEntry, readHistory, clearHistory,
} from '@nexusmd/core'

const TABS = ['Params', 'Headers', 'Body', 'Auth', 'Scripts', 'Tests', 'History']
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']

const EMPTY_REQUEST = {
  method: 'GET', url: '', params: {}, headers: {}, body: '',
  bodyType: 'none', bodyLanguage: 'json',
  auth: { type: 'none' }, preRequestScript: '', postResponseScript: '', tests: '',
}

const BODY_TYPES = ['none', 'raw', 'urlencoded', 'formdata']
const BODY_TYPE_LABELS = { none: 'None', raw: 'Raw', urlencoded: 'x-www-form-urlencoded', formdata: 'form-data' }
const RAW_LANGUAGES = ['json', 'text', 'xml']

function ensurePairs(pairs) {
  return Array.isArray(pairs) && pairs.length ? pairs : [{ key: '', value: '' }]
}

/**
 * Merges a saved request with EMPTY_REQUEST's defaults. A request saved
 * before bodyType existed has no bodyType field at all — treat that the
 * same way request-builder.js does (raw/text, i.e. "just send the string"),
 * so its body keeps showing instead of silently looking empty.
 */
function hydrateRequest(saved) {
  const merged = { ...EMPTY_REQUEST, ...saved }
  if (saved && saved.bodyType === undefined) {
    merged.bodyType = typeof saved.body === 'string' && saved.body ? 'raw' : 'none'
    merged.bodyLanguage = 'text'
  }
  return merged
}

function kvPairsToObject(pairs) {
  const out = {}
  for (const { key, value } of pairs) if (key) out[key] = value
  return out
}

function objectToKvPairs(obj) {
  const pairs = Object.entries(obj || {}).map(([key, value]) => ({ key, value }))
  return pairs.length ? pairs : [{ key: '', value: '' }]
}

function KvEditor({ pairs, onChange }) {
  const update = (i, field, val) => {
    const next = pairs.map((p, idx) => (idx === i ? { ...p, [field]: val } : p))
    onChange(next)
  }
  const remove = (i) => onChange(pairs.length > 1 ? pairs.filter((_, idx) => idx !== i) : [{ key: '', value: '' }])
  const addRow = () => onChange([...pairs, { key: '', value: '' }])

  return (
    <div>
      {pairs.map((p, i) => (
        <div key={i} className="ac-kv-row">
          <input className="ac-input" placeholder="key" value={p.key} onChange={e => update(i, 'key', e.target.value)}/>
          <input className="ac-input" placeholder="value" value={p.value} onChange={e => update(i, 'value', e.target.value)}/>
          <button className="btn sm icon ghost" onClick={() => remove(i)} title="Remove row">
            <Icon name="x" size={13}/>
          </button>
        </div>
      ))}
      <button className="ac-add-link" onClick={addRow}>+ Add</button>
    </div>
  )
}

function TreeNode({ node, depth, onSelect, selectedRefId, requests }) {
  if (node.type === 'folder') {
    return (
      <div>
        <div className="ac-tree-folder" style={{ paddingLeft: depth * 14 }}>{node.name}</div>
        {(node.children || []).map((c, i) => (
          <TreeNode key={c.refId || `${node.name}-${i}`} node={c} depth={depth + 1} onSelect={onSelect} selectedRefId={selectedRefId} requests={requests}/>
        ))}
      </div>
    )
  }
  const active = node.refId === selectedRefId
  const method = requests?.[node.refId]?.method || 'GET'
  return (
    <div
      className={`ac-tree-item${active ? ' active' : ''}`}
      style={{ paddingLeft: depth * 14 + 8 }}
      onClick={() => onSelect(node.refId)}
    >
      <span className="ac-method-tag" data-method={method}>{method}</span>
      <span className="ac-tree-item-name">{node.name}</span>
    </div>
  )
}

export function ApiClientView() {
  const { adapters, available } = useApiClient()

  // Which collections are loaded, and which are collapsed — both persisted so
  // a multi-collection workspace survives an app restart.
  const [loadedDirs, setLoadedDirs] = usePersisted('nexusmd.apiClient.loadedDirs', [])
  const [collapsedDirs, setCollapsedDirs] = usePersisted('nexusmd.apiClient.collapsedDirs', () => new Set())
  const [collections, setCollections] = React.useState({}) // dir -> { dir, meta, requests, environments, activeEnv } | { dir, error }

  const [newDirInput, setNewDirInput] = React.useState('')
  const [openError, setOpenError] = React.useState(null)
  const [importDir, setImportDir] = React.useState(null)
  const [importText, setImportText] = React.useState('')

  const [activeDir, setActiveDir] = React.useState(null)
  const [selectedRefId, setSelectedRefId] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [activeTab, setActiveTab] = React.useState('Params')
  const [sending, setSending] = React.useState(false)
  const [response, setResponse] = React.useState(null)
  const [responseTab, setResponseTab] = React.useState('Body')
  const [runningDir, setRunningDir] = React.useState(null)
  const [runReport, setRunReport] = React.useState(null)
  const [history, setHistory] = React.useState([])
  const [historyPreview, setHistoryPreview] = React.useState(null)

  const didMountLoad = React.useRef(false)
  React.useEffect(() => {
    if (didMountLoad.current || !available) return
    didMountLoad.current = true
    loadedDirs.forEach(dir => {
      loadCollection(adapters.file, dir)
        .then(loaded => setCollections(prev => ({ ...prev, [dir]: { ...loaded, activeEnv: '' } })))
        .catch(err => setCollections(prev => ({ ...prev, [dir]: { dir, error: err?.message || String(err) } })))
    })
    // Runs once on mount to restore the previously-open collections; loadedDirs
    // itself is intentionally not a dependency so re-ordering it later doesn't
    // trigger a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available])

  const updateCollection = (dir, patch) => {
    setCollections(prev => ({
      ...prev,
      [dir]: { ...prev[dir], ...(typeof patch === 'function' ? patch(prev[dir]) : patch) },
    }))
  }

  const openCollection = async (dir) => {
    if (!dir) { setOpenError('Choose a collection folder first.'); return }
    setOpenError(null)
    try {
      let loaded
      try {
        loaded = await loadCollection(adapters.file, dir)
      } catch {
        await createCollection(adapters.file, dir, { name: dir })
        loaded = await loadCollection(adapters.file, dir)
      }
      setCollections(prev => ({ ...prev, [dir]: { ...loaded, activeEnv: prev[dir]?.activeEnv || '' } }))
      setLoadedDirs(prev => (prev.includes(dir) ? prev : [...prev, dir]))
      setNewDirInput('')
    } catch (err) {
      setOpenError(err?.message || String(err))
    }
  }

  const browseForCollection = async () => {
    const dir = await adapters.picker?.pickDirectory?.()
    if (!dir) return
    openCollection(dir)
  }

  const unloadCollection = (dir) => {
    setLoadedDirs(prev => prev.filter(d => d !== dir))
    setCollections(prev => { const next = { ...prev }; delete next[dir]; return next })
    setCollapsedDirs(prev => { if (!prev.has(dir)) return prev; const next = new Set(prev); next.delete(dir); return next })
    if (importDir === dir) { setImportDir(null); setImportText('') }
    if (activeDir === dir) {
      setActiveDir(null)
      setSelectedRefId(null)
      setDraft(null)
      setResponse(null)
      setHistory([])
      setHistoryPreview(null)
    }
  }

  const toggleCollapsed = (dir) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir); else next.add(dir)
      return next
    })
  }

  const selectRequest = (dir, refId) => {
    setActiveDir(dir)
    setSelectedRefId(refId)
    setDraft(hydrateRequest(collections[dir].requests[refId]))
    setResponse(null)
    setHistoryPreview(null)
    readHistory(adapters.file, dir, refId).then(setHistory)
  }

  const newRequest = async (dir) => {
    const col = collections[dir]
    if (!col) return
    const refId = `req-${Date.now()}`
    const requestDef = { ...EMPTY_REQUEST, url: '' }
    await writeRequest(adapters.file, dir, refId, requestDef)
    const nextTree = addTreeNode(col.meta.tree, [], { type: 'request', name: 'New request', refId })
    const nextMeta = { ...col.meta, tree: nextTree }
    await writeCollectionMeta(adapters.file, dir, nextMeta)
    updateCollection(dir, prev => ({ meta: nextMeta, requests: { ...prev.requests, [refId]: requestDef } }))
    setCollapsedDirs(prev => { if (!prev.has(dir)) return prev; const next = new Set(prev); next.delete(dir); return next })
    setActiveDir(dir)
    setSelectedRefId(refId)
    setDraft({ ...requestDef })
    setResponse(null)
    setHistory([])
    setHistoryPreview(null)
  }

  const saveDraft = async () => {
    if (!activeDir || !selectedRefId) return
    await writeRequest(adapters.file, activeDir, selectedRefId, draft)
    updateCollection(activeDir, prev => ({ requests: { ...prev.requests, [selectedRefId]: draft } }))
  }

  const resolvedVars = async (dir) => {
    const col = collections[dir]
    if (!col?.activeEnv || !col.environments?.[col.activeEnv]) return {}
    return resolveEnvironment(adapters.secureStorage, dir, col.activeEnv, col.environments[col.activeEnv])
  }

  const send = async () => {
    if (!draft || !activeDir) return
    setSending(true)
    setResponse(null)
    setResponseTab('Body')
    try {
      const vars = await resolvedVars(activeDir)
      const result = await executeRequest(draft, { vars, adapters })
      setResponse(result)
      if (selectedRefId) {
        const entry = {
          sentAt: Date.now(),
          status: result.status,
          request: { method: draft.method, url: draft.url },
          response: result.response,
          error: result.error,
        }
        const nextHistory = await appendHistoryEntry(adapters.file, activeDir, selectedRefId, entry)
        setHistory(nextHistory)
      }
    } finally {
      setSending(false)
    }
  }

  const clearRequestHistory = async () => {
    if (!activeDir || !selectedRefId) return
    await clearHistory(adapters.file, activeDir, selectedRefId)
    setHistory([])
    setHistoryPreview(null)
  }

  const runFolder = async (dir, nodes) => {
    const col = collections[dir]
    if (!col) return
    setRunningDir(dir)
    setRunReport(null)
    try {
      const vars = await resolvedVars(dir)
      const entries = buildRunEntries(col, nodes)
      const report = await runCollection(entries, { vars, adapters })
      setRunReport({ ...report, collectionName: col.meta.name })
    } finally {
      setRunningDir(null)
    }
  }

  const doImport = async () => {
    const dir = importDir
    const col = collections[dir]
    if (!col || !importText.trim()) return
    let json
    try { json = JSON.parse(importText) } catch { setOpenError('Import failed: not valid JSON'); return }
    const { meta, tree, requests, warnings } = importPostmanCollection(json)
    for (const [refId, req] of Object.entries(requests)) {
      await writeRequest(adapters.file, dir, refId, req)
    }
    const importedFolder = { type: 'folder', name: meta.name, children: tree }
    const nextMeta = { ...col.meta, tree: [...col.meta.tree, importedFolder] }
    await writeCollectionMeta(adapters.file, dir, nextMeta)
    updateCollection(dir, prev => ({ meta: nextMeta, requests: { ...prev.requests, ...requests } }))
    setImportText('')
    setImportDir(null)
    if (warnings.length) setOpenError(`Imported with ${warnings.length} warning(s): ${warnings.join('; ')}`)
  }

  if (!available) {
    return (
      <div className="ac-unavailable">
        <Icon name="alert" size={18}/>
        <div>The API client isn't available on this platform yet — it currently requires the desktop app.</div>
      </div>
    )
  }

  return (
    <div className="ac-shell">
      <div className="ac-sidebar">
        <div className="ac-sidebar-head">
          <div className="ac-add-row">
            <input
              className="ac-input" placeholder="Collection folder path" value={newDirInput}
              onChange={e => setNewDirInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') openCollection(newDirInput) }}
            />
            <button className="btn sm icon" onClick={() => openCollection(newDirInput)} title="Load collection">
              <Icon name="plus" size={14}/>
            </button>
            {adapters.picker && (
              <button className="btn sm icon" onClick={browseForCollection} title="Browse for folder">
                <Icon name="folder" size={14}/>
              </button>
            )}
          </div>
          {openError && <div className="ac-error-text" style={{ marginTop: 8 }}>{openError}</div>}
        </div>

        <div className="ac-collections">
          {loadedDirs.length === 0 && (
            <div className="ac-empty-note">No collections loaded yet. Open a folder above to get started.</div>
          )}

          {loadedDirs.map(dir => {
            const col = collections[dir]

            if (!col) {
              return (
                <div key={dir} className="ac-collection">
                  <div className="ac-collection-head">
                    <span className="ac-collection-name ac-loading">{dir}</span>
                  </div>
                </div>
              )
            }

            if (col.error) {
              return (
                <div key={dir} className="ac-collection">
                  <div className="ac-collection-error">
                    <Icon name="alert" size={14}/>
                    <span className="ac-collection-name">{dir}</span>
                    <button className="btn sm icon ghost" onClick={() => unloadCollection(dir)} title="Remove">
                      <Icon name="x" size={13}/>
                    </button>
                  </div>
                </div>
              )
            }

            const collapsed = collapsedDirs.has(dir)

            return (
              <div key={dir} className="ac-collection">
                <div className="ac-collection-head" onClick={() => toggleCollapsed(dir)}>
                  <span className="chev"><Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={13}/></span>
                  <span className="ac-collection-name" title={col.meta.name}>{col.meta.name}</span>
                  <div className="ac-collection-actions" onClick={e => e.stopPropagation()}>
                    <button className="btn sm icon ghost" onClick={() => newRequest(dir)} title="New request">
                      <Icon name="plus" size={13}/>
                    </button>
                    <button className="btn sm icon ghost" onClick={() => unloadCollection(dir)} title="Unload collection">
                      <Icon name="x" size={13}/>
                    </button>
                  </div>
                </div>

                {!collapsed && (
                  <div className="ac-collection-body">
                    {Object.keys(col.environments).length > 0 && (
                      <select
                        className="ac-select block" value={col.activeEnv}
                        onChange={e => updateCollection(dir, { activeEnv: e.target.value })}
                      >
                        <option value="">No environment</option>
                        {Object.keys(col.environments).map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    )}

                    <button className="btn sm" onClick={() => runFolder(dir, col.meta.tree)} disabled={runningDir === dir}>
                      <Icon name="play" size={12}/> {runningDir === dir ? 'Running…' : 'Run collection'}
                    </button>

                    <div className="ac-tree">
                      {col.meta.tree.map((n, i) => (
                        <TreeNode
                          key={n.refId || i} node={n} depth={0} requests={col.requests}
                          onSelect={refId => selectRequest(dir, refId)}
                          selectedRefId={activeDir === dir ? selectedRefId : null}
                        />
                      ))}
                      {col.meta.tree.length === 0 && <div className="ac-empty-note">No requests yet.</div>}
                    </div>

                    <details
                      className="ac-import" open={importDir === dir}
                      onToggle={e => {
                        if (e.target.open) { setImportDir(dir); setImportText('') }
                        else if (importDir === dir) setImportDir(null)
                      }}
                    >
                      <summary>Import Postman collection</summary>
                      <textarea
                        className="ac-code" rows={4} placeholder="Paste Postman v2.1 collection.json"
                        value={importDir === dir ? importText : ''} onChange={e => setImportText(e.target.value)}
                      />
                      <button className="btn sm" onClick={doImport}>Import</button>
                    </details>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="ac-main">
        {!draft && <div className="ac-empty">Select or create a request to begin.</div>}

        {draft && (
          <>
            <div className="ac-request-bar">
              <select
                className="ac-select ac-method-select" data-method={draft.method} value={draft.method}
                onChange={e => setDraft({ ...draft, method: e.target.value })}
              >
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input
                className="ac-input ac-url-input" value={draft.url}
                onChange={e => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://api.example.com/{{path}}"
              />
              <div className="ac-request-actions">
                <button className="btn sm" onClick={saveDraft}>Save</button>
                <button className="btn sm accent" onClick={send} disabled={sending}>
                  <Icon name="send" size={12}/> {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>

            <div className="ac-tabs">
              {TABS.map(tab => (
                <button key={tab} className={`ac-tab${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 'Params' && (
              <KvEditor pairs={objectToKvPairs(draft.params)} onChange={pairs => setDraft({ ...draft, params: kvPairsToObject(pairs) })}/>
            )}
            {activeTab === 'Headers' && (
              <KvEditor pairs={objectToKvPairs(draft.headers)} onChange={pairs => setDraft({ ...draft, headers: kvPairsToObject(pairs) })}/>
            )}
            {activeTab === 'Body' && (
              <div>
                <div className="ac-body-toolbar">
                  <select
                    className="ac-select" aria-label="Body type" value={draft.bodyType || 'none'}
                    onChange={e => {
                      const bodyType = e.target.value
                      const nextBody = bodyType === 'raw'
                        ? (typeof draft.body === 'string' ? draft.body : '')
                        : (bodyType === 'none' ? draft.body : ensurePairs(Array.isArray(draft.body) ? draft.body : []))
                      setDraft({ ...draft, bodyType, body: nextBody })
                    }}
                  >
                    {BODY_TYPES.map(t => <option key={t} value={t}>{BODY_TYPE_LABELS[t]}</option>)}
                  </select>
                  {draft.bodyType === 'raw' && (
                    <select
                      className="ac-select" aria-label="Raw body language" value={draft.bodyLanguage || 'json'}
                      onChange={e => setDraft({ ...draft, bodyLanguage: e.target.value })}
                    >
                      {RAW_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  )}
                </div>

                {(!draft.bodyType || draft.bodyType === 'none') && (
                  <div className="ac-empty-note">This request has no body.</div>
                )}

                {draft.bodyType === 'raw' && (
                  <textarea className="ac-code" rows={10} value={draft.body || ''} onChange={e => setDraft({ ...draft, body: e.target.value })}/>
                )}

                {(draft.bodyType === 'urlencoded' || draft.bodyType === 'formdata') && (
                  <KvEditor pairs={ensurePairs(draft.body)} onChange={pairs => setDraft({ ...draft, body: pairs })}/>
                )}
              </div>
            )}
            {activeTab === 'Auth' && (
              <div>
                <select
                  className="ac-select" value={draft.auth?.type || 'none'} style={{ marginBottom: 8 }}
                  onChange={e => setDraft({ ...draft, auth: { type: e.target.value } })}
                >
                  {['none', 'bearer', 'basic', 'apikey', 'oauth2'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {draft.auth?.type === 'bearer' && (
                  <input
                    className="ac-input" placeholder="Token" value={draft.auth.token || ''} style={{ width: '100%' }}
                    onChange={e => setDraft({ ...draft, auth: { ...draft.auth, token: e.target.value } })}
                  />
                )}
                {draft.auth?.type === 'basic' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="ac-input" placeholder="Username" value={draft.auth.username || ''} style={{ flex: 1, minWidth: 0 }}
                      onChange={e => setDraft({ ...draft, auth: { ...draft.auth, username: e.target.value } })}
                    />
                    <input
                      className="ac-input" placeholder="Password" type="password" value={draft.auth.password || ''} style={{ flex: 1, minWidth: 0 }}
                      onChange={e => setDraft({ ...draft, auth: { ...draft.auth, password: e.target.value } })}
                    />
                  </div>
                )}
                {draft.auth?.type === 'apikey' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="ac-input" placeholder="Key" value={draft.auth.key || ''} style={{ flex: 1, minWidth: 0 }}
                      onChange={e => setDraft({ ...draft, auth: { ...draft.auth, key: e.target.value } })}
                    />
                    <input
                      className="ac-input" placeholder="Value" value={draft.auth.value || ''} style={{ flex: 1, minWidth: 0 }}
                      onChange={e => setDraft({ ...draft, auth: { ...draft.auth, value: e.target.value } })}
                    />
                    <select
                      className="ac-select" value={draft.auth.in || 'header'}
                      onChange={e => setDraft({ ...draft, auth: { ...draft.auth, in: e.target.value } })}
                    >
                      <option value="header">header</option>
                      <option value="query">query</option>
                    </select>
                  </div>
                )}
                {draft.auth?.type === 'oauth2' && (
                  <input
                    className="ac-input" placeholder="Access token" value={draft.auth.accessToken || ''} style={{ width: '100%' }}
                    onChange={e => setDraft({ ...draft, auth: { ...draft.auth, accessToken: e.target.value } })}
                  />
                )}
              </div>
            )}
            {activeTab === 'Scripts' && (
              <div>
                <div className="ac-field-label">Pre-request script</div>
                <textarea
                  className="ac-code" rows={6} style={{ marginBottom: 10 }} value={draft.preRequestScript || ''}
                  onChange={e => setDraft({ ...draft, preRequestScript: e.target.value })}
                />
                <div className="ac-field-label">Post-response script</div>
                <textarea
                  className="ac-code" rows={6} value={draft.postResponseScript || ''}
                  onChange={e => setDraft({ ...draft, postResponseScript: e.target.value })}
                />
              </div>
            )}
            {activeTab === 'Tests' && (
              <textarea
                className="ac-code" rows={10} value={draft.tests || ''}
                placeholder="context.tests.push({ name: 'status is 200', passed: context.response.status === 200 })"
                onChange={e => setDraft({ ...draft, tests: e.target.value })}
              />
            )}
            {activeTab === 'History' && (
              <div>
                <div className="ac-history-toolbar">
                  <span className="ac-history-count">{history.length} sent</span>
                  <button className="btn sm ghost" onClick={clearRequestHistory} disabled={!history.length}>
                    <Icon name="trash" size={12}/> Clear history
                  </button>
                </div>
                {history.length === 0 && <div className="ac-empty-note">No requests sent yet.</div>}
                {[...history].reverse().map((entry, i) => (
                  <button
                    key={i} type="button"
                    className={`ac-history-row${historyPreview === entry ? ' active' : ''}`}
                    onClick={() => setHistoryPreview(entry)}
                  >
                    <span className={`pill ${entry.status === 'passed' ? 'success' : entry.status === 'failed' ? 'danger' : 'warning'}`}>
                      {entry.status}
                    </span>
                    <span className="mono">{entry.request?.method}</span>
                    <span className="ac-history-time">
                      {new Date(entry.sentAt).toLocaleTimeString()}
                      {entry.response && ` · ${entry.response.durationMs}ms`}
                    </span>
                  </button>
                ))}
                {historyPreview && (
                  <div className="ac-history-preview">
                    <div className="ac-field-label">{historyPreview.request?.method} {historyPreview.request?.url}</div>
                    {historyPreview.response
                      ? <JsonPretty text={historyPreview.response.body}/>
                      : <div className="ac-error-text">{historyPreview.error}</div>}
                  </div>
                )}
              </div>
            )}

            {response && (
              <div className="ac-response">
                <div className="ac-response-status">
                  <span className={`pill ${response.status === 'passed' ? 'success' : response.status === 'failed' ? 'danger' : 'warning'}`}>
                    {response.status}
                  </span>
                  {response.response && (
                    <span className="mono ac-response-meta">
                      {response.response.status} {response.response.statusText} · {response.response.durationMs}ms
                    </span>
                  )}
                  {response.error && <span className="ac-error-text">{response.error}</span>}
                </div>
                {response.tests && response.tests.length > 0 && (
                  <div className="ac-tests">
                    {response.tests.map((t, i) => (
                      <div key={i} className={`ac-test-row ${t.passed ? 'pass' : 'fail'}`}>
                        {t.passed ? '✓' : '✗'} {t.name}
                      </div>
                    ))}
                  </div>
                )}
                {response.response && (
                  <>
                    <div className="ac-tabs sm">
                      {['Body', 'Headers'].map(tab => (
                        <button key={tab} className={`ac-tab${responseTab === tab ? ' active' : ''}`} onClick={() => setResponseTab(tab)}>
                          {tab}
                        </button>
                      ))}
                    </div>
                    {responseTab === 'Body' && <JsonPretty text={response.response.body}/>}
                    {responseTab === 'Headers' && (
                      <div className="ac-headers-list">
                        {Object.entries(response.response.headers || {}).map(([k, v]) => (
                          <div key={k} className="ac-header-row">
                            <strong>{k}</strong><span>{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {runReport && (
          <div className="ac-response">
            <strong>Run results — {runReport.collectionName}: {runReport.passed} passed, {runReport.failed} failed ({runReport.totalDurationMs}ms)</strong>
            <div className="ac-tests" style={{ marginTop: 8 }}>
              {runReport.results.map((r, i) => (
                <div key={i} className={`ac-test-row ${r.status === 'passed' ? 'pass' : 'fail'}`}>
                  {r.status === 'passed' ? '✓' : '✗'} {r.name} — {r.status}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
