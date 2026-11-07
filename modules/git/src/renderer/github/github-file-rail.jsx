import React from 'react'
import { relativeTime } from '../history-pane.jsx'

const baseOf = path => path.slice(path.lastIndexOf('/') + 1)
const dirOf = path => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/**
 * The GitHub Files tab's right-hand panel for the picked file: its name and where it is, the open pull request
 * that changes it (when one does), its latest commits on the branch, and the ways to open or link it. `primary`
 * is the editor action ({ label, onSelect }, none when there is no editor to open it in); `prs` and `commits`
 * come from useFilePrs and useFileCommits (commits is null while loading).
 */
export function GithubFileRail({ branch, path, prs, commits, primary, onOpenGithub, onCopyPermalink, onViewPrs }) {
  const pr = prs[0]
  const dir = dirOf(path)
  return (
    <div className="nx-gw-crail">
      <div className="nx-gw-rail-head">
        <div className="nx-gw-rail-file">{baseOf(path)}</div>
        <div className="nx-gw-rail-dir">{dir ? `${dir} · on ${branch}` : `on ${branch}`}</div>
      </div>
      {pr && (
        <>
          <div className="nx-gw-eyebrow">Open pull request</div>
          <div className="nx-gw-card">
            <div className="nx-gw-last-subject">{`#${pr.number} ${pr.title}`}</div>
            <div className="nx-gw-status-line">
              <span>Changes this file</span>
              <span className="add">{`+${pr.add}`}</span>
              <span className="del">{`−${pr.del}`}</span>
            </div>
            <button type="button" className="nx-link nx-gw-linkbtn" onClick={onViewPrs}>View in Pull requests</button>
          </div>
        </>
      )}
      <div className="nx-gw-eyebrow">{`History on ${branch}`}</div>
      {commits === null ? <div className="nx-gw-rail-note">Loading…</div>
        : !commits.length ? <div className="nx-gw-rail-note">No commits yet.</div>
          : (
            <ul className="nx-gw-rail-commits">
              {commits.map(c => (
                <li key={c.sha}>
                  <div className="row" title={c.subject}>
                    <span className="subject">{c.subject}</span>
                    <span className="meta"><span className="nx-hash">{c.sha.slice(0, 7)}</span>{c.date ? ` · ${relativeTime(Date.parse(c.date))}` : ''}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
      <div className="nx-gw-spacer-y" />
      {primary && <button className="btn accent nx-gw-crail-primary" onClick={primary.onSelect}>{primary.label}</button>}
      <button className="btn nx-gw-crail-secondary" onClick={onOpenGithub}>Open on GitHub</button>
      <button className="btn ghost nx-gw-crail-secondary" onClick={onCopyPermalink}>Copy permalink</button>
    </div>
  )
}
