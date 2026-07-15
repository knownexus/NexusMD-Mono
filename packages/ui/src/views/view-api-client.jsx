import React from 'react'
// view-api-client.jsx — general-purpose API client (Bruno/Postman-style).
// Desktop-only for now: useApiClient().available is false until the host wires
// real `file`/`scriptRunner` adapters (see api-client-context.jsx), which today
// only apps/desktop does.

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
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input placeholder="key" value={p.key} onChange={e => update(i, 'key', e.target.value)}
            style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
          <input placeholder="value" value={p.value} onChange={e => update(i, 'value', e.target.value)}
            style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
          <button onClick={() => remove(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Icon name="x" size={14}/>
          </button>
        </div>
      ))}
      <button onClick={addRow} style={{ fontSize: 12, border: 'none', background: 'none', color: 'var(--accent, #1d6fcc)', cursor: 'pointer', padding: 0 }}>
        + Add
      </button>
    </div>
  )
}

function TreeNode({ node, depth, onSelect, selectedRefId }) {
  if (node.type === 'folder') {
    return (
      <div>
        <div style={{ paddingLeft: depth * 14, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', padding: '4px 0' }}>
          {node.name}
        </div>
        {(node.children || []).map((c, i) => (
          <TreeNode key={c.refId || `${node.name}-${i}`} node={c} depth={depth + 1} onSelect={onSelect} selectedRefId={selectedRefId} />
        ))}
      </div>
    )
  }
  const active = node.refId === selectedRefId
  return (
    <div
      onClick={() => onSelect(node.refId)}
      style={{
        paddingLeft: depth * 14 + 8, padding: '5px 8px', fontSize: 13, cursor: 'pointer', borderRadius: 6,
        background: active ? 'var(--surface-3, rgba(29,111,204,0.12))' : 'transparent',
      }}
    >
      {node.name}
    </div>
  )
}

export function ApiClientView() {
  const { adapters, available } = useApiClient()
  const [dirInput, setDirInput] = usePersisted('nexusmd.apiClient.lastDir', '')
  const [collection, setCollection] = React.useState(null)
  const [openError, setOpenError] = React.useState(null)
  const [activeEnv, setActiveEnv] = usePersisted('nexusmd.apiClient.activeEnv', '')
  const [selectedRefId, setSelectedRefId] = React.useState(null)
  const [draft, setDraft] = React.useState(null)
  const [activeTab, setActiveTab] = React.useState('Params')
  const [sending, setSending] = React.useState(false)
  const [response, setResponse] = React.useState(null)
  const [responseTab, setResponseTab] = React.useState('Body')
  const [runReport, setRunReport] = React.useState(null)
  const [running, setRunning] = React.useState(false)
  const [importText, setImportText] = React.useState('')
  const [history, setHistory] = React.useState([])
  const [historyPreview, setHistoryPreview] = React.useState(null)

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
      setCollection(loaded)
      setDirInput(dir)
    } catch (err) {
      setOpenError(err?.message || String(err))
    }
  }

  const browseForCollection = async () => {
    const dir = await adapters.picker?.pickDirectory?.()
    if (!dir) return
    setDirInput(dir)
    openCollection(dir)
  }

  const selectRequest = (refId) => {
    setSelectedRefId(refId)
    setDraft(hydrateRequest(collection.requests[refId]))
    setResponse(null)
    setHistoryPreview(null)
    readHistory(adapters.file, dirInput, refId).then(setHistory)
  }

  const newRequest = async () => {
    if (!collection) return
    const refId = `req-${Date.now()}`
    const requestDef = { ...EMPTY_REQUEST, url: '' }
    await writeRequest(adapters.file, dirInput, refId, requestDef)
    const nextTree = addTreeNode(collection.meta.tree, [], { type: 'request', name: 'New request', refId })
    const nextMeta = { ...collection.meta, tree: nextTree }
    await writeCollectionMeta(adapters.file, dirInput, nextMeta)
    setCollection({ ...collection, meta: nextMeta, requests: { ...collection.requests, [refId]: requestDef } })
    setSelectedRefId(refId)
    setDraft({ ...requestDef })
  }

  const saveDraft = async () => {
    if (!collection || !selectedRefId) return
    await writeRequest(adapters.file, dirInput, selectedRefId, draft)
    setCollection({ ...collection, requests: { ...collection.requests, [selectedRefId]: draft } })
  }

  const resolvedVars = async () => {
    if (!activeEnv || !collection?.environments?.[activeEnv]) return {}
    return resolveEnvironment(adapters.secureStorage, dirInput, activeEnv, collection.environments[activeEnv])
  }

  const send = async () => {
    if (!draft) return
    setSending(true)
    setResponse(null)
    setResponseTab('Body')
    try {
      const vars = await resolvedVars()
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
        const nextHistory = await appendHistoryEntry(adapters.file, dirInput, selectedRefId, entry)
        setHistory(nextHistory)
      }
    } finally {
      setSending(false)
    }
  }

  const clearRequestHistory = async () => {
    if (!selectedRefId) return
    await clearHistory(adapters.file, dirInput, selectedRefId)
    setHistory([])
    setHistoryPreview(null)
  }

  const runFolder = async (nodes) => {
    if (!collection) return
    setRunning(true)
    setRunReport(null)
    try {
      const vars = await resolvedVars()
      const entries = buildRunEntries(collection, nodes)
      const report = await runCollection(entries, { vars, adapters })
      setRunReport(report)
    } finally {
      setRunning(false)
    }
  }

  const doImport = async () => {
    if (!collection || !importText.trim()) return
    let json
    try { json = JSON.parse(importText) } catch { setOpenError('Import failed: not valid JSON'); return }
    const { meta, tree, requests, warnings } = importPostmanCollection(json)
    for (const [refId, req] of Object.entries(requests)) {
      await writeRequest(adapters.file, dirInput, refId, req)
    }
    const importedFolder = { type: 'folder', name: meta.name, children: tree }
    const nextMeta = { ...collection.meta, tree: [...collection.meta.tree, importedFolder] }
    await writeCollectionMeta(adapters.file, dirInput, nextMeta)
    setCollection({ ...collection, meta: nextMeta, requests: { ...collection.requests, ...requests } })
    setImportText('')
    if (warnings.length) setOpenError(`Imported with ${warnings.length} warning(s): ${warnings.join('; ')}`)
  }

  if (!available) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        <Icon name="alert" size={18}/>
        <div style={{ marginTop: 8 }}>The API client isn't available on this platform yet — it currently requires the desktop app.</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 260, borderRight: '1px solid var(--border)', padding: 12, overflowY: 'auto' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input placeholder="Collection folder path" value={dirInput} onChange={e => setDirInput(e.target.value)}
            style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
          <button onClick={() => openCollection(dirInput)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
            Open
          </button>
          {adapters.picker && (
            <button onClick={browseForCollection} title="Browse for folder" style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
              <Icon name="folder" size={14}/>
            </button>
          )}
        </div>
        {openError && <div style={{ color: 'var(--danger, #d33)', fontSize: 12, marginBottom: 8 }}>{openError}</div>}

        {collection && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{collection.meta.name}</strong>
              <button onClick={newRequest} title="New request" style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
                <Icon name="plus" size={14}/>
              </button>
            </div>

            {Object.keys(collection.environments).length > 0 && (
              <select value={activeEnv} onChange={e => setActiveEnv(e.target.value)}
                style={{ width: '100%', marginBottom: 8, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}>
                <option value="">No environment</option>
                {Object.keys(collection.environments).map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            )}

            <button onClick={() => runFolder(collection.meta.tree)} disabled={running}
              style={{ width: '100%', marginBottom: 10, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
              {running ? 'Running…' : 'Run collection'}
            </button>

            {collection.meta.tree.map((n, i) => (
              <TreeNode key={n.refId || i} node={n} depth={0} onSelect={selectRequest} selectedRefId={selectedRefId}/>
            ))}

            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Import Postman collection</div>
              <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={4} placeholder="Paste Postman v2.1 collection.json"
                style={{ width: '100%', fontSize: 11, padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
              <button onClick={doImport} style={{ marginTop: 6, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
                Import
              </button>
            </div>
          </>
        )}
      </div>

      <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
        {!draft && <div style={{ color: 'var(--text-muted)' }}>Select or create a request to begin.</div>}

        {draft && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <select value={draft.method} onChange={e => setDraft({ ...draft, method: e.target.value })}
                style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} placeholder="https://api.example.com/{{path}}"
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
              <button onClick={saveDraft} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>Save</button>
              <button onClick={send} disabled={sending} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--accent, #1d6fcc)', color: '#fff', cursor: 'pointer' }}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid var(--border)' }}>
              {TABS.map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{
                    padding: '6px 10px', border: 'none', background: 'none', cursor: 'pointer',
                    borderBottom: activeTab === tab ? '2px solid var(--accent, #1d6fcc)' : '2px solid transparent',
                    fontWeight: activeTab === tab ? 600 : 400,
                  }}>
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
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                  <select
                    aria-label="Body type"
                    value={draft.bodyType || 'none'}
                    onChange={e => {
                      const bodyType = e.target.value
                      const nextBody = bodyType === 'raw'
                        ? (typeof draft.body === 'string' ? draft.body : '')
                        : (bodyType === 'none' ? draft.body : ensurePairs(Array.isArray(draft.body) ? draft.body : []))
                      setDraft({ ...draft, bodyType, body: nextBody })
                    }}
                    style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
                  >
                    {BODY_TYPES.map(t => <option key={t} value={t}>{BODY_TYPE_LABELS[t]}</option>)}
                  </select>
                  {draft.bodyType === 'raw' && (
                    <select
                      aria-label="Raw body language"
                      value={draft.bodyLanguage || 'json'}
                      onChange={e => setDraft({ ...draft, bodyLanguage: e.target.value })}
                      style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
                    >
                      {RAW_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  )}
                </div>

                {(!draft.bodyType || draft.bodyType === 'none') && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>This request has no body.</div>
                )}

                {draft.bodyType === 'raw' && (
                  <textarea value={draft.body || ''} onChange={e => setDraft({ ...draft, body: e.target.value })} rows={10}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
                )}

                {(draft.bodyType === 'urlencoded' || draft.bodyType === 'formdata') && (
                  <KvEditor pairs={ensurePairs(draft.body)} onChange={pairs => setDraft({ ...draft, body: pairs })}/>
                )}
              </div>
            )}
            {activeTab === 'Auth' && (
              <div>
                <select value={draft.auth?.type || 'none'} onChange={e => setDraft({ ...draft, auth: { type: e.target.value } })}
                  style={{ marginBottom: 8, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}>
                  {['none', 'bearer', 'basic', 'apikey', 'oauth2'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {draft.auth?.type === 'bearer' && (
                  <input placeholder="Token" value={draft.auth.token || ''} onChange={e => setDraft({ ...draft, auth: { ...draft.auth, token: e.target.value } })}
                    style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
                )}
                {draft.auth?.type === 'basic' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input placeholder="Username" value={draft.auth.username || ''} onChange={e => setDraft({ ...draft, auth: { ...draft.auth, username: e.target.value } })}
                      style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
                    <input placeholder="Password" type="password" value={draft.auth.password || ''} onChange={e => setDraft({ ...draft, auth: { ...draft.auth, password: e.target.value } })}
                      style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
                  </div>
                )}
                {draft.auth?.type === 'apikey' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input placeholder="Key" value={draft.auth.key || ''} onChange={e => setDraft({ ...draft, auth: { ...draft.auth, key: e.target.value } })}
                      style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
                    <input placeholder="Value" value={draft.auth.value || ''} onChange={e => setDraft({ ...draft, auth: { ...draft.auth, value: e.target.value } })}
                      style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
                    <select value={draft.auth.in || 'header'} onChange={e => setDraft({ ...draft, auth: { ...draft.auth, in: e.target.value } })}
                      style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}>
                      <option value="header">header</option>
                      <option value="query">query</option>
                    </select>
                  </div>
                )}
                {draft.auth?.type === 'oauth2' && (
                  <input placeholder="Access token" value={draft.auth.accessToken || ''} onChange={e => setDraft({ ...draft, auth: { ...draft.auth, accessToken: e.target.value } })}
                    style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
                )}
              </div>
            )}
            {activeTab === 'Scripts' && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Pre-request script</div>
                <textarea value={draft.preRequestScript || ''} onChange={e => setDraft({ ...draft, preRequestScript: e.target.value })} rows={6}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, marginBottom: 10, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Post-response script</div>
                <textarea value={draft.postResponseScript || ''} onChange={e => setDraft({ ...draft, postResponseScript: e.target.value })} rows={6}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
              </div>
            )}
            {activeTab === 'Tests' && (
              <textarea value={draft.tests || ''} onChange={e => setDraft({ ...draft, tests: e.target.value })} rows={10}
                placeholder="context.tests.push({ name: 'status is 200', passed: context.response.status === 200 })"
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}/>
            )}
            {activeTab === 'History' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{history.length} sent</span>
                  <button onClick={clearRequestHistory} disabled={!history.length}
                    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}>
                    Clear history
                  </button>
                </div>
                {history.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>No requests sent yet.</div>}
                {[...history].reverse().map((entry, i) => (
                  <button key={i} type="button" onClick={() => setHistoryPreview(entry)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                      fontSize: 12.5, marginBottom: 4, border: 'none', color: 'var(--text)',
                      background: historyPreview === entry ? 'var(--surface-3, rgba(29,111,204,0.12))' : 'var(--surface-2)',
                    }}>
                    {entry.status} · {entry.request?.method} · {new Date(entry.sentAt).toLocaleTimeString()}
                    {entry.response && ` · ${entry.response.durationMs}ms`}
                  </button>
                ))}
                {historyPreview && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{historyPreview.request?.method} {historyPreview.request?.url}</div>
                    {historyPreview.response
                      ? <JsonPretty text={historyPreview.response.body}/>
                      : <div style={{ color: 'var(--danger, #d33)', fontSize: 12.5 }}>{historyPreview.error}</div>}
                  </div>
                )}
              </div>
            )}

            {response && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                  <strong>{response.status}</strong>
                  {response.response && <span>{response.response.status} {response.response.statusText} · {response.response.durationMs}ms</span>}
                  {response.error && <span style={{ color: 'var(--danger, #d33)' }}>{response.error}</span>}
                </div>
                {response.tests && response.tests.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    {response.tests.map((t, i) => (
                      <div key={i} style={{ fontSize: 12.5, color: t.passed ? 'var(--success, #2a2)' : 'var(--danger, #d33)' }}>
                        {t.passed ? '✓' : '✗'} {t.name}
                      </div>
                    ))}
                  </div>
                )}
                {response.response && (
                  <>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                      {['Body', 'Headers'].map(tab => (
                        <button key={tab} onClick={() => setResponseTab(tab)}
                          style={{
                            padding: '4px 10px', border: 'none', background: 'none', cursor: 'pointer',
                            borderBottom: responseTab === tab ? '2px solid var(--accent, #1d6fcc)' : '2px solid transparent',
                            fontWeight: responseTab === tab ? 600 : 400,
                          }}>
                          {tab}
                        </button>
                      ))}
                    </div>
                    {responseTab === 'Body' && <JsonPretty text={response.response.body}/>}
                    {responseTab === 'Headers' && (
                      <div>
                        {Object.entries(response.response.headers || {}).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', gap: 6, fontSize: 12.5, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                            <strong style={{ minWidth: 160 }}>{k}</strong><span>{v}</span>
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
          <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <strong>Run results: {runReport.passed} passed, {runReport.failed} failed ({runReport.totalDurationMs}ms)</strong>
            <div style={{ marginTop: 8 }}>
              {runReport.results.map((r, i) => (
                <div key={i} style={{ fontSize: 12.5, color: r.status === 'passed' ? 'var(--success, #2a2)' : 'var(--danger, #d33)' }}>
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
