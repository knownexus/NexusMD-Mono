import React from 'react'

/**
 * The preview's 40px path bar: the file's path as crumbs (the last one current), shrinking and fading at the
 * right edge when it is too long, and `children` (File | Diff, the branch picker) on the right.
 */
export function PathBar({ segments, children = null }) {
  return (
    <div className="nx-gw-pathbar">
      <nav aria-label="File path" title={segments.join('/')} className="nx-gw-pathbar-crumbs">
        {segments.map((s, i) => {
          const last = i === segments.length - 1
          return (
            <React.Fragment key={i}>
              {i > 0 && <span className="sep" aria-hidden="true">›</span>}
              <span className={last ? 'crumb last' : 'crumb'} aria-current={last ? 'page' : undefined}>{s}</span>
            </React.Fragment>
          )
        })}
      </nav>
      {children && <div className="nx-gw-pathbar-end">{children}</div>}
    </div>
  )
}
