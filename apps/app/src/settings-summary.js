// settings-summary.js — the one-line summaries under each Settings category on a phone, built from
// what is actually set rather than a fixed description.

const hostOf = (site) => String(site || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.atlassian\.net$/, '');

// Which providers are connected: the same rule as core's isAdoConfigured / isJiraConfigured /
// isGithubConfigured, so a provider whose token was removed is not shown as connected just because
// its organisation or site is still saved.
export function connectedProviders({ ado, jira, github } = {}) {
  return {
    ado: !!(ado?.org && ado.pat && ado.projects?.length),
    jira: !!(jira?.site && jira.email && jira.apiToken && jira.projectKeys?.length),
    github: !!(github?.pat && github.repos?.length),
  };
}

// "Azure DevOps (acme) · Jira (acme) · GitHub (3 repos)".
export function connectionsSummary({ ado, jira, github } = {}) {
  const on = connectedProviders({ ado, jira, github });
  const parts = [];
  if (on.ado) parts.push(`Azure DevOps (${ado.org})`);
  if (on.jira) parts.push(`Jira (${hostOf(jira.site)})`);
  if (on.github) { const n = github.repos.length; parts.push(`GitHub (${n} repo${n === 1 ? '' : 's'})`); }
  return parts.length ? parts.join(' · ') : 'Nothing connected yet';
}

export const privacySummary = ({ hasPassword, autoRelock } = {}) =>
  `${hasPassword ? 'Password set' : 'No password yet'} · auto re-lock ${autoRelock === '1' ? 'on' : 'off'}`;

// `pending` is what the offline queue still has to send; `unsaved` and `conflicts` are the account sync's (useSyncSummary),
// absent without an account.
export function dataSummary({ pending = 0, loadedLabel = '', unsaved = 0, conflicts = 0 } = {}) {
  const parts = [];
  if (loadedLabel) parts.push(loadedLabel);
  if (pending > 0) parts.push(`${pending} change${pending === 1 ? '' : 's'} waiting to be sent`);
  if (conflicts > 0) parts.push(`${conflicts} sync conflict${conflicts === 1 ? '' : 's'}`);
  if (unsaved > 0) parts.push(`${unsaved} not saved to your account`);
  return parts.join(' · ') || 'Storage, sync and versions';
}
