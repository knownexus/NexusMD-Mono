// source-filter.js — which provider a work item, PR, build or test run came from, and the pure
// bits of showing one provider at a time. The UI (hook + switch) is in source-switch.jsx.
export const SOURCE_ORDER = ['ado', 'jira', 'github'];
export const SOURCE_LABELS = { ado: 'Azure DevOps', jira: 'Jira', github: 'GitHub' };

// ADO items carry no `source`; Jira and GitHub items do (and Jira ids start with 'jira:').
export const itemSource = (x) => x?.source || (/^jira:/.test(String(x?.id ?? '')) ? 'jira' : 'ado');

// The providers present in `list`, in a fixed order.
export const sourcesIn = (list) => SOURCE_ORDER.filter(p => (list || []).some(x => itemSource(x) === p));

// The saved choice while it still has items, otherwise the first provider that does.
export const pickSource = (saved, available) => (available.includes(saved) ? saved : available[0] || null);

// With one provider (or none) nothing is filtered and no switch is shown.
export const filterBySource = (list, sources, source) => (
  sources.length > 1 ? (list || []).filter(x => itemSource(x) === source) : (list || [])
);
