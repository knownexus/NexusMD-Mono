// triage.jsx — shared triage-export controls used by both the Dashboard and Work Items views.
//   <TriageExportButton/>  — pulls open work items from ADO into triage-tracker/exports and refreshes the .xlsx
//   <TriageStatusLine/>    — small line showing when the tracker was last generated
// Loaded after data.jsx (for timeAgo), icons.jsx (Icon) and toast.jsx (toast).

// Tiny bus so a successful export tells any visible status lines to re-fetch.
const TriageEvents = (() => {
  const subs = new Set();
  return { sub: (fn) => { subs.add(fn); return () => subs.delete(fn); }, fire: () => subs.forEach(fn => fn()) };
})();

function TriageExportButton() {
  return null; // Export requires server-side SQLite — not available on Android.
}

function TriageStatusLine() {
  return null; // Status requires server-side tracker — not available on Android.
}

Object.assign(window, { TriageExportButton, TriageStatusLine, TriageEvents });



export { TriageEvents, TriageExportButton, TriageStatusLine };