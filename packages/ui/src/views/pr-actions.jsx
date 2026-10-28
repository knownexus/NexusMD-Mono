// PRActions — Approve / Wait for author / Reject / Merge buttons for a pull request.
// `actions` is the object returned by makePRActions (core).
import React, { useState } from 'react'
import { toast } from '../toast.jsx'

export function PRActions({ pr, actions, onChanged, confirm = (...a) => window.confirm(...a) }) {
  const [busy, setBusy] = useState(false)
  const [dlg, setDlg] = useState(null) // null | { loading, methods, method, deleteBranch }

  if (!pr || (pr.status !== 'active' && pr.status !== 'draft')) return null

  async function run(label, successText, fn) {
    if (busy) return false
    setBusy(true)
    try {
      const { patch, warnings = [] } = await fn()
      toast?.(successText, 'success')
      warnings.forEach(w => toast?.(w, 'warning'))
      onChanged?.(patch)
      return true
    } catch (e) {
      toast?.(`${label} failed: ${e?.message || e}`, 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    if (busy) return
    setBusy(true)
    let ok = false
    try {
      const { rejectConfirm } = await actions.mergeOptions(pr)
      ok = confirm(rejectConfirm)
    } catch (e) {
      toast?.(`Reject failed: ${e?.message || e}`, 'error')
    }
    setBusy(false)
    if (ok) run('Reject', 'Pull request rejected', () => actions.reject(pr))
  }

  async function openMerge() {
    if (busy) return
    setDlg({ loading: true, methods: [], method: '', deleteBranch: true })
    try {
      const { methods } = await actions.mergeOptions(pr)
      setDlg(d => d && { ...d, loading: false, methods, method: methods[0]?.id || '' })
    } catch (e) {
      setDlg(null)
      toast?.(`Merge failed: ${e?.message || e}`, 'error')
    }
  }

  async function doMerge() {
    const { method, deleteBranch } = dlg
    const ok = await run('Merge', 'Merged', () => actions.merge(pr, { method, deleteBranch }))
    if (ok) setDlg(null)
  }

  return (
    <div className="pr-actions">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn sm" disabled={busy} onClick={() => run('Approve', 'Approved', () => actions.approve(pr))}>Approve</button>
        <button className="btn sm" disabled={busy} onClick={() => run('Wait for author', 'Marked as waiting for author', () => actions.waitForAuthor(pr))}>Wait for author</button>
        <button className="btn sm ghost danger" disabled={busy} onClick={reject}>Reject</button>
        {pr.status !== 'draft' && <button className="btn sm primary" disabled={busy} onClick={openMerge}>Merge</button>}
      </div>
      {dlg && (
        <div role="dialog" aria-label="Merge pull request" style={{ marginTop: 8, display: 'grid', gap: 8 }}>
          {!dlg.loading && dlg.methods.length === 0 && <div>This repository allows no merge methods</div>}
          {dlg.methods.length > 0 && (
            <select aria-label="Merge type" value={dlg.method} onChange={e => setDlg({ ...dlg, method: e.target.value })}>
              {dlg.methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
          <label>
            <input type="checkbox" checked={dlg.deleteBranch} onChange={e => setDlg({ ...dlg, deleteBranch: e.target.checked })} /> Delete source branch
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn sm primary" disabled={busy || dlg.loading || !dlg.method} onClick={doMerge}>Merge</button>
            <button className="btn sm" disabled={busy} onClick={() => setDlg(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
