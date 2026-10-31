// tests-phone.jsx — the Tests page on a phone. Two dropdowns replace the rows of filter pills, a
// single row of totals replaces the stat cards, and each run is a row that opens to its actions.
// TestsView does the filtering and paging; this only lays the result out.
import React from 'react';
import { Icon } from '../icons.jsx';
import { HelmData } from '../data.jsx';
import { NotificationBanner } from '../components.jsx';
import { SourceSwitch } from '../source-switch.jsx';

export const RESULT_LABELS = {
  succeeded: 'Succeeded', failed: 'Failed', partiallySucceeded: 'Partially succeeded',
  inProgress: 'In progress', canceled: 'Cancelled', notStarted: 'Not started', acknowledged: 'Acknowledged',
};
export const resultLabel = (r) => RESULT_LABELS[r] || r;
const PILL = { succeeded: 'success', failed: 'danger', partiallySucceeded: 'warning', inProgress: 'info', acknowledged: 'warning' };

// What the Result dropdown shows for a selection that is a set (it was a multi-select of pills).
export const resultValue = (results) => (results.size === 0 ? 'all' : results.size === 1 ? [...results][0] : '__many');

export function PhoneTests({
  src, tests, pipelines, statuses, pipeline, setPipeline, results, setResults,
  failedCount, acknowledgedCount, totalRuns, totalTests, totalPassed, totalFailed, passRate,
  grouped, collapsed, setCollapsed, expandedRun, setExpandedRun, dispResult, acknowledgedSet, toggleAck,
  newItemIds, initialNewCount, bannerDismissed, setBannerDismissed,
  page, totalPages, pageSize, setPage,
}) {
  const filtersOn = pipeline !== 'all' || results.size > 0;
  const countOf = (r) => (r === 'failed' ? failedCount : tests.filter(t => t.result === r).length);
  const pickResult = (v) => setResults(v === 'all' ? new Set() : new Set([v]));
  const from = totalRuns === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRuns);

  return (
    <>
      <div className="m-appbar">
        <div className="m-ab-lead">
          <div>
            <h1>Tests</h1>
            <div className="m-ab-sub">
              {totalRuns} runs · {totalTests ? `${totalPassed}/${totalTests} passed` : 'No test totals available'}
              {acknowledgedCount > 0 ? ` · ${acknowledgedCount} acknowledged` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="m-screen">
        <SourceSwitch {...src}/>
        {initialNewCount > 0 && !bannerDismissed && (
          <NotificationBanner
            label={`${initialNewCount} new test result${initialNewCount !== 1 ? 's' : ''} since your last visit`}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        <div className="m-filters">
          <select className="m-select" aria-label="Pipeline" value={pipeline} onChange={e => setPipeline(e.target.value)}>
            <option value="all">All pipelines ({tests.length})</option>
            {pipelines.map(p => <option key={p} value={p}>{p} ({tests.filter(t => t.pipeline === p).length})</option>)}
          </select>
          <select className="m-select" aria-label="Result" value={resultValue(results)} onChange={e => pickResult(e.target.value)}>
            <option value="all">All results</option>
            {results.size > 1 && <option value="__many" disabled>{results.size} results</option>}
            {statuses.map(r => <option key={r} value={r}>{resultLabel(r)} ({countOf(r)})</option>)}
            {acknowledgedCount > 0 && <option value="acknowledged">Acknowledged ({acknowledgedCount})</option>}
          </select>
        </div>
        {filtersOn && (
          <div style={{ marginTop: -4, marginBottom: 10 }}>
            <button type="button" className="m-linkbtn" onClick={() => { setPipeline('all'); setResults(new Set()); }}>Clear filters</button>
          </div>
        )}

        <div className="m-totals">
          <div><span className="v">{totalRuns}</span><span className="l">Runs</span></div>
          <div><span className="v">{passRate == null ? '—' : `${passRate}%`}</span><span className="l">Pass rate</span></div>
          <div><span className="v" style={totalFailed > 0 ? { color: 'var(--danger)' } : undefined}>{totalFailed}</span><span className="l">Failed tests</span></div>
        </div>

        {grouped.length === 0 && (
          <div className="m-empty">
            <div className="et">No test runs match</div>
            {filtersOn && <button type="button" className="btn m-btn-lg" style={{ marginTop: 12 }}
              onClick={() => { setPipeline('all'); setResults(new Set()); }}>Clear filters</button>}
          </div>
        )}

        {grouped.map(g => (
          <React.Fragment key={g.name}>
            <div className="m-sec-h" style={{ cursor: 'pointer' }} onClick={() => setCollapsed(c => ({ ...c, [g.name]: !c[g.name] }))}>
              <span className="ic"><Icon name={collapsed[g.name] ? 'chevron-right' : 'chevron-down'} size={13}/></span>
              <span className="lbl">{g.name}</span><span className="line"/><span className="cnt">{g.runs.length}</span>
            </div>
            {!collapsed[g.name] && (
              <div className="m-card flush">
                {g.runs.map(run => {
                  const res = dispResult(run);
                  const open = expandedRun === run.id;
                  const isNew = newItemIds.has(run.id);
                  const url = HelmData.ORG && run.project
                    ? `https://dev.azure.com/${encodeURIComponent(HelmData.ORG)}/${encodeURIComponent(run.project)}/_build/results?buildId=${run.id}&view=ms.vss-test-web.build-test-results-tab`
                    : null;
                  return (
                    <React.Fragment key={`${g.name}-${run.id}`}>
                      <div className={`m-row${isNew ? ' row-flash' : ''}`} onClick={() => setExpandedRun(open ? null : run.id)}>
                        <div className="m-row-main">
                          <div className="m-row-title">#{run.id} <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>· {run.branch || 'main'}</span></div>
                          <div className="m-row-sub" style={res === 'acknowledged' ? { color: 'var(--warning)' } : undefined}>
                            {run.totalTests != null
                              ? `${run.passedTests || 0} passed · ${run.failedTests || 0} failed · ${run.totalTests} total`
                              : 'No test run totals'}
                          </div>
                        </div>
                        <div className="m-run-side">
                          <span className={`pill ${PILL[res] || ''}`}>{resultLabel(res)}</span>
                          <span className="m-id">{[run.duration, run.when].filter(Boolean).join(' · ') || '-'}</span>
                        </div>
                        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} className="chev"/>
                      </div>
                      {open && (
                        <div className="m-run-actions">
                          {run.result === 'failed' && (
                            <button type="button" className="btn m-btn-lg" onClick={() => toggleAck(run.id)}>
                              <Icon name={acknowledgedSet.has(run.id) ? 'x' : 'check'} size={14}/> {acknowledgedSet.has(run.id) ? 'Unacknowledge' : 'Acknowledge'}
                            </button>
                          )}
                          <button type="button" className="btn m-btn-lg" onClick={() => {
                            window.dispatchEvent(new CustomEvent('helm:create-wi', {
                              detail: {
                                type: 'Bug',
                                title: `Test failure: ${g.name}`,
                                description: `Run #${run.id}\nPipeline: ${g.name}\nBranch: ${run.branch || 'main'}\nFailed tests: ${run.failedTests || 0}/${run.totalTests || 0}`,
                                project: (HelmData.CONFIG_PROJECTS || [])[0] || '',
                                tags: 'test;qa',
                              },
                            }));
                          }}><Icon name="plus" size={14}/> Create bug</button>
                          {url && <a className="btn m-btn-lg" href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                            <Icon name="link" size={14}/> Open in Azure DevOps</a>}
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </React.Fragment>
        ))}

        {totalRuns > 0 && (
          <div className="m-pager">
            <button type="button" className="btn m-btn-lg" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="Previous page">
              <Icon name="chevron-left" size={16}/>
            </button>
            <span>{from}–{to} of {totalRuns}</span>
            <button type="button" className="btn m-btn-lg" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="Next page">
              <Icon name="chevron-right" size={16}/>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
