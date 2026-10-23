// fold-all-button.jsx — one button that folds every section, or unfolds them all once they're
// all folded. Shared by the lists that group their rows (Database tables, Git repositories).

import { Icon } from './icons.jsx'

/**
 * @param {boolean} allCollapsed  Every section shown is folded (the button then unfolds them).
 * @param {() => void} onExpandAll
 * @param {() => void} onCollapseAll
 * @param {string} [what]  What's being folded, for the tooltip ("repositories", "groups").
 */
export function FoldAllButton({ allCollapsed, onExpandAll, onCollapseAll, what = 'sections', disabled = false, className = 'btn sm ghost' }) {
  const label = allCollapsed ? 'Expand all' : 'Collapse all'
  return (
    <button type="button" className={className} disabled={disabled}
      title={allCollapsed ? `Unfold all ${what}` : `Fold all ${what}`}
      onClick={allCollapsed ? onExpandAll : onCollapseAll}>
      <Icon name={allCollapsed ? 'expand' : 'collapse'} size={12} />{label}
    </button>
  )
}
