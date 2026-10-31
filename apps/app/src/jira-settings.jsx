// jira-settings.jsx — Jira Cloud connection modal (site, email, API token, projects).
import React, { useState, useEffect } from 'react';
import { makeJiraClient, JIRA_CACHE_KEY } from '@nexusmd/core';
import { SettField } from '@nexusmd/ui';
import { Icon } from './icons.jsx';
import { getJiraConfig, saveJiraConfig, createJiraHttpAdapter } from './jira-client.js';

const inputStyle = {
  width: '100%', padding: '7px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--surface-2)', outline: 'none', fontSize: 13, boxSizing: 'border-box',
};
const splitKeys = (s) => s.split(/[,\s]+/).map(k => k.trim()).filter(Boolean);

export function JiraSettingsModal({ open, onClose, onSaved }) {
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [keys, setKeys] = useState('');
  const [jql, setJql] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const c = getJiraConfig();
    setSite(c.site || ''); setEmail(c.email || ''); setToken('');
    setKeys((c.projectKeys || []).join(', ')); setJql(c.jql || '');
    setEnabled(c.enabled !== false); setStatus('');
  }, [open]);

  const connection = () => ({
    site: site.trim(), email: email.trim(), ...(token.trim() ? { apiToken: token.trim() } : {}),
  });

  const test = async () => {
    setBusy(true); setStatus('Testing…');
    try {
      saveJiraConfig(connection());
      const me = await makeJiraClient(createJiraHttpAdapter()).get('rest/api/3/myself');
      setStatus(`Connected as ${me?.displayName || 'unknown user'}`);
    } catch (e) {
      setStatus('Error: ' + (e?.message || 'connection failed'));
    } finally { setBusy(false); }
  };

  const save = () => {
    saveJiraConfig({ ...connection(), projectKeys: splitKeys(keys), jql: jql.trim(), enabled });
    // Drop the cache so the reload refetches metadata for the new settings.
    try { localStorage.removeItem(JIRA_CACHE_KEY); } catch (_) {}
    setToken('');
    setStatus('Saved! Reloading data…');
    onSaved?.();
    setTimeout(onClose, 1000);
  };

  if (!open) return null;
  const isError = status.startsWith('Error');
  return (
    <div id="modal-jira" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16,
        boxShadow: 'var(--shadow-pop)', width: 520, maxWidth: '100%',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px 16px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, flex: 1 }}>Jira Cloud Settings</h2>
          <button className="btn icon ghost sm" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>
        <div style={{ padding: '16px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/>
            Load Jira work items
          </label>
          <SettField label="Site" hint="yoursite, yoursite.atlassian.net, or a full Jira URL">
            <input value={site} onChange={e => setSite(e.target.value)} placeholder="yoursite" style={inputStyle}/>
          </SettField>
          <SettField label="Email" hint="The Atlassian account email the API token belongs to">
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" style={inputStyle}/>
          </SettField>
          <SettField label="API token" hint="Leave blank to keep the existing token.">
            <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Leave blank to keep existing token" style={inputStyle}/>
          </SettField>
          <SettField label="Project keys" hint="Comma-separated, e.g. ABC, DEF.">
            <input value={keys} onChange={e => setKeys(e.target.value)} placeholder="ABC, DEF" style={inputStyle}/>
          </SettField>
          <SettField label="Extra JQL filter" hint="ANDed with the project filter (optional).">
            <input value={jql} onChange={e => setJql(e.target.value)} style={inputStyle}/>
          </SettField>
        </div>
        <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {status && (
            <div style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 13,
              background: isError ? 'var(--danger-soft)' : 'var(--success-soft)',
              color: isError ? 'var(--danger)' : 'var(--success)',
            }}>{status}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={test} disabled={busy}>{busy ? 'Testing…' : 'Test connection'}</button>
            <button className="btn primary" onClick={save} disabled={busy}>Save &amp; connect</button>
          </div>
        </div>
      </div>
    </div>
  );
}
