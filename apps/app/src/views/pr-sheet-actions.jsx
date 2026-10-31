// pr-sheet-actions.jsx — your vote and a comment box inside the PR sheet, for ADO and GitHub PRs.
// Both go through the offline queue: with no connection they are kept and sent when it returns.
import React from 'react';
import { appQueue } from '../offline-queue-app.js';
import { adoGet } from '../ado-client.js';
import { votesFor, canVote, canComment, myVoteOf, adoVoteLabel, minimalPR, resolveAdoId } from '../pr-actions-phone.js';

const label = (pr, v) => votesFor(pr).find(x => x.v === v)?.label || adoVoteLabel(v);
const OFFLINE = "Saved. It will be sent when you're back online.";

export function PRSheetActions({ pr, me: meIn, githubLogin, onFlash, lookupAdoId = () => resolveAdoId(adoGet) }) {
  const github = pr.source === 'github';
  // The loaded data doesn't always carry your ADO identity; ask for it when voting needs it.
  const [foundId, setFoundId] = React.useState('');
  React.useEffect(() => {
    if (github || meIn?.adoId || foundId) return;
    let live = true;
    Promise.resolve(lookupAdoId()).then(id => { if (live && id) setFoundId(id); });
    return () => { live = false; };
  }, [github, meIn?.adoId, foundId]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = meIn?.adoId || !foundId ? meIn : { ...meIn, adoId: foundId };
  const [myVote, setMyVote] = React.useState(() => myVoteOf(pr, me, githubLogin));
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  React.useEffect(() => { setMyVote(myVoteOf(pr, me, githubLogin)); setText(''); setError(''); }, [pr.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const castVote = async (v) => {
    const before = myVote;
    setBusy('vote'); setError('');
    try {
      const r = await appQueue.run('pr.vote', { pr: minimalPR(pr), vote: v, adoId: me?.adoId }, `Vote on ${pr.displayId || pr.id}`);
      setMyVote(v);
      // ADO can reset a vote; a GitHub review can't be taken back from here.
      const undo = github || r.queued ? undefined : async () => {
        setMyVote(before);
        try { await appQueue.run('pr.vote', { pr: minimalPR(pr), vote: before, adoId: me?.adoId }, 'Undo vote'); }
        catch (e) { setMyVote(v); onFlash?.(`Could not undo: ${e?.message || 'failed'}`, 'alert'); }
      };
      onFlash?.(r.queued ? OFFLINE : `Voted: ${label(pr, v)}`, 'check', undo);
    } catch (e) { setError(e?.message || 'The vote failed.'); }
    finally { setBusy(''); }
  };

  const post = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy('comment'); setError('');
    try {
      const r = await appQueue.run('pr.comment', { pr: minimalPR(pr), text: body }, `Comment on ${pr.displayId || pr.id}`);
      setText('');
      onFlash?.(r.queued ? OFFLINE : 'Comment posted', 'check');
    } catch (e) { setError(e?.message || 'The comment failed.'); }
    finally { setBusy(''); }
  };

  const showVote = canVote(pr, me);
  if (!showVote && !canComment(pr)) return null;
  return (
    <div className="m-pr-actions">
      {showVote && (
        <section aria-label="Your vote">
          <div className="m-sec-h"><span className="lbl">Your vote</span><span className="line"/>
            <span className="cnt">{myVote ? label(pr, myVote) : 'none yet'}</span></div>
          <div className="m-votes">
            {votesFor(pr).map(o => (
              <button key={String(o.v)} type="button" className={`btn m-btn-lg${myVote === o.v ? ' primary' : ''}`} aria-pressed={myVote === o.v}
                disabled={!!busy} onClick={() => castVote(o.v)}>{o.label}</button>
            ))}
          </div>
        </section>
      )}
      {canComment(pr) && (
        <section aria-label="Comment">
          <div className="m-sec-h"><span className="lbl">Comment</span><span className="line"/></div>
          <textarea className="m-docs-text short" style={{ fontFamily: 'inherit', fontSize: 14 }} value={text} onChange={e => setText(e.target.value)}
            placeholder="Write a comment…" aria-label="Comment"/>
          <button type="button" className="btn primary m-btn-lg" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
            disabled={!text.trim() || !!busy} onClick={post}>{busy === 'comment' ? 'Posting…' : 'Post comment'}</button>
        </section>
      )}
      {error && <div className="m-error" role="alert" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}
