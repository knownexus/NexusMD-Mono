// md-extras-ui.jsx — the Markdown Compare differences list, shared by the desktop Markdown view and the
// phone layout. It takes the two texts as props and reads nothing else. Every line is rendered as React
// text, never as HTML, so a document can't inject markup into the page.
import React from 'react';
import { diffLines, diffCounts, collapseDiff, MAX_DIFF_LINES } from '@nexusmd/core';

/** What changed from `before` (the other document) to `after` (the open one), with added and removed
 *  counts and long unchanged stretches folded into a "⋯ N unchanged lines" row. */
export function MarkdownDiff({ before, after, otherName }) {
  const diff = React.useMemo(() => diffLines(before || '', after || ''), [before, after]);
  if (diff === null) return <div className="m-diff-sum">These documents are too long to compare (over {MAX_DIFF_LINES} lines).</div>;
  const c = diffCounts(diff);
  return (
    <>
      <div className="m-diff-sum">
        {c.added === 0 && c.removed === 0
          ? 'No differences.'
          : <><span className="m-diff-add">+{c.added} added</span> · <span className="m-diff-del">−{c.removed} removed</span>{otherName ? <> compared with {otherName}</> : null}</>}
      </div>
      <div className="m-diff" role="region" aria-label="Differences">
        {collapseDiff(diff).map((d, i) => d.t === 'gap'
          ? <div key={i} className="gap">⋯ {d.v}</div>
          : (
            <div key={i} className={`ln ${d.t === '+' ? 'add' : d.t === '-' ? 'del' : ''}`}>
              <span className="sg">{d.t === '=' ? ' ' : d.t === '+' ? '+' : '−'}</span><span className="tx">{d.v || ' '}</span>
            </div>
          ))}
      </div>
    </>
  );
}
