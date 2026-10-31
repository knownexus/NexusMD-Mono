// pr-merge-sheet.jsx — merge (Azure DevOps: complete) or close (abandon) a pull request from the phone,
// for both providers, over the shared PR actions. These are never queued for later: merging a PR
// that was reviewed hours ago is not something to replay on reconnect, so offline it says so.
import React from 'react';
import { makeGithubClient, makePRActions } from '@nexusmd/core';
import { Sheet } from '../components.jsx';
import { createAdoHttpAdapter } from '../ado-client.js';
import { createGithubHttpAdapter } from '../github-client.js';

export const OFFLINE_MERGE = "You're offline. Merging and closing need a connection.";

export function defaultActions(adoMeId) {
  return makePRActions({ adoHttp: createAdoHttpAdapter(), adoMeId, githubClient: makeGithubClient(createGithubHttpAdapter()) });
}

// The two things you can still do to an open PR: merge it, or close it without merging.
export function canMerge(pr) { return !!pr && pr.status === 'active' && !pr.draft; }
export function canClose(pr) { return !!pr && (pr.status === 'active' || pr.status === 'draft'); }

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export function PRMergeSheet({ pr, mode, adoMeId, onClose, onDone, makeActions = defaultActions, online = isOnline }) {
  const [methods, setMethods] = React.useState(null);
  const [method, setMethod] = React.useState('');
  const [deleteBranch, setDeleteBranch] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const open = !!mode;
  const merging = mode === 'merge';
  const provider = pr?.source === 'github' ? 'GitHub' : 'Azure DevOps';

  React.useEffect(() => {
    if (!open || !merging || !pr) return;
    setMethods(null); setError(''); setBusy(false); setDeleteBranch(true);
    let live = true;
    makeActions(adoMeId).mergeOptions(pr)
      .then(r => { if (live) { setMethods(r.methods); setMethod(r.methods[0]?.id || ''); } })
      .catch(e => { if (live) { setMethods([]); setError(e?.message || 'Could not load the merge options.'); } });
    return () => { live = false; };
  }, [open, merging, pr?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { if (open) { setError(''); setBusy(false); } }, [open]);

  const confirm = async () => {
    if (!online()) { setError(OFFLINE_MERGE); return; }
    setBusy(true); setError('');
    try {
      const actions = makeActions(adoMeId);
      const r = merging ? await actions.merge(pr, { method, deleteBranch }) : await actions.reject(pr);
      onDone?.({ patch: r.patch, warnings: r.warnings || [], merged: merging && r.patch?.status === 'merged' });
      onClose();
    } catch (e) {
      setError(e?.message || (merging ? 'The merge failed.' : 'Could not close the pull request.'));
    } finally { setBusy(false); }
  };

  const label = merging ? (provider === 'GitHub' ? 'Merge pull request' : 'Complete pull request') : (provider === 'GitHub' ? 'Close pull request' : 'Abandon pull request');
  const none = merging && methods && methods.length === 0;
  return (
    <Sheet open={open} icon="merge" title={label} sub={pr ? `${pr.displayId || `#${pr.id}`} · ${pr.title || ''}`.slice(0, 80) : ''} onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn ghost m-btn-lg" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={`btn m-btn-lg ${merging ? 'primary' : ''}`} style={merging ? undefined : { color: 'var(--danger)', borderColor: 'var(--danger)' }}
            disabled={busy || (merging && (!method || !methods))} onClick={confirm}>
            {busy ? 'Working…' : merging ? 'Merge' : provider === 'GitHub' ? 'Close it' : 'Abandon it'}
          </button>
        </>
      )}>
      {merging ? (
        <>
          {!methods && !error && <div className="muted">Loading merge options…</div>}
          {none && <div className="m-error">This repository allows no merge methods.</div>}
          {methods && methods.length > 0 && (
            <>
              <div className="m-fld">
                <label htmlFor="merge-method">Merge type</label>
                <select id="merge-method" className="m-select" value={method} onChange={e => setMethod(e.target.value)}>
                  {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <label className="m-switchrow">
                <input type="checkbox" checked={deleteBranch} onChange={e => setDeleteBranch(e.target.checked)}/>
                <span>Delete the source branch after merging</span>
              </label>
            </>
          )}
        </>
      ) : (
        <div className="m-hint" style={{ marginTop: 0 }}>
          {provider === 'GitHub' ? 'This closes the pull request without merging it.' : 'This abandons the pull request without completing it.'} It can be reopened later from {provider}.
        </div>
      )}
      {error && <div className="m-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </Sheet>
  );
}
