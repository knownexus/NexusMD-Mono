// settings-summary.js — the one-line summaries under each Settings category on a phone, built from
// what is actually set rather than a fixed description.

const hostOf = (site) => String(site || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.atlassian\.net$/, '');

// Which providers are connected: "Azure DevOps (acme) · Jira (acme) · GitHub (3 repos)".
export function connectionsSummary({ ado, jira, github } = {}) {
  const parts = [];
  if (ado?.org) parts.push(`Azure DevOps (${ado.org})`);
  if (jira?.site) parts.push(`Jira (${hostOf(jira.site)})`);
  const repos = github?.repos?.length || 0;
  if (github?.pat && repos) parts.push(`GitHub (${repos} repo${repos === 1 ? '' : 's'})`);
  return parts.length ? parts.join(' · ') : 'Nothing connected yet';
}

export const privacySummary = ({ hasPassword, autoRelock } = {}) =>
  `${hasPassword ? 'Password set' : 'No password yet'} · auto re-lock ${autoRelock === '1' ? 'on' : 'off'}`;

export function dataSummary({ pending = 0, loadedLabel = '' } = {}) {
  const parts = [];
  if (loadedLabel) parts.push(loadedLabel);
  if (pending > 0) parts.push(`${pending} change${pending === 1 ? '' : 's'} waiting to sync`);
  return parts.join(' · ') || 'Storage, sync and versions';
}
