// autosave-form.js — connection forms that save as you type. Each field is checked as it changes; once
// every field is valid the values are saved a moment after the last keystroke. Nothing is saved while
// a field is wrong, and nothing is saved just for opening the form.
import React from 'react';

const trim = (s) => String(s ?? '').trim();

// ── Checks (each returns { field: message }; empty means valid) ──────────────
export function validateAdoForm(v) {
  const e = {};
  const org = trim(v.org);
  if (!org) e.org = 'Enter your organisation name.';
  else if (/[\s/]/.test(org) || /dev\.azure\.com/i.test(org)) e.org = 'Just the name that follows dev.azure.com/.';
  if (trim(v.pat) && trim(v.pat).length < 20) e.pat = 'That token looks too short.';
  const n = Number(v.interval);
  if (!Number.isFinite(n) || n < 10 || n > 3600) e.interval = 'Between 10 and 3600 seconds.';
  if (trim(v.uatPipelineId) && !/^\d+$/.test(trim(v.uatPipelineId))) e.uatPipelineId = 'Numbers only.';
  return e;
}

export function validateJiraForm(v) {
  const e = {};
  const site = trim(v.site);
  if (!site) e.site = 'Enter your Jira site.';
  else if (!/^(https:\/\/)?[a-z0-9][a-z0-9-]*(\.atlassian\.net)?\/?$/i.test(site)) e.site = 'Use yoursite or yoursite.atlassian.net, with nothing else.';
  const email = trim(v.email);
  if (!email) e.email = 'Enter the Atlassian account email.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'That does not look like an email address.';
  if (trim(v.token) && trim(v.token).length < 10) e.token = 'That token looks too short.';
  const bad = String(v.keys || '').split(/[,\s]+/).map(trim).filter(Boolean).filter(k => !/^[A-Za-z][A-Za-z0-9_]*$/.test(k));
  if (bad.length) e.keys = `Project keys are letters and numbers, like ABC. Check: ${bad.join(', ')}.`;
  return e;
}

export const hasErrors = (errors) => Object.keys(errors || {}).length > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What the footer says.
export function savedLabel({ errors, status }) {
  if (hasErrors(errors)) return 'Fix the marked fields to save.';
  return status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Changes save as you type.';
}

// Watches `values` against `initial`; checks them on every change and, when valid, saves after `delay`.
// `dirty` says something was saved, so the caller can reload its data when the form is closed.
// `hold` names fields that point at a server (site, organisation). While one differs from what was
// saved nothing autosaves, so a stored token is never sent to a half-typed address; it saves on
// flush() (Done) or an explicit Test connection.
export function useFormAutosave({ enabled, values, initial, validate, save, delay = 700, hold = [] }) {
  const [status, setStatus] = React.useState('idle');
  const [dirty, setDirty] = React.useState(false);
  const errors = React.useMemo(() => (enabled && !same(values, initial) ? validate(values) : {}), [enabled, values, initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify(values);
  const saveRef = React.useRef(save); saveRef.current = save;
  const held = hold.some(k => values[k] !== initial[k]);
  const flush = () => {
    if (!enabled || same(values, initial) || hasErrors(errors)) return false;
    try { saveRef.current(values); setDirty(true); setStatus('saved'); return true; } catch { return false; }
  };

  React.useEffect(() => { if (!enabled) { setStatus('idle'); setDirty(false); } }, [enabled]);
  React.useEffect(() => {
    if (!enabled || same(values, initial) || hasErrors(errors) || held) return;
    setStatus('saving');
    const t = setTimeout(() => {
      try { saveRef.current(values); setStatus('saved'); setDirty(true); } catch { setStatus('idle'); }
    }, delay);
    return () => clearTimeout(t);
  }, [key, enabled, held]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = !hasErrors(errors) && held ? 'The server address changed: tap Done or Test connection to save it.' : savedLabel({ errors, status });
  return { errors, status, dirty, flush, label };
}
