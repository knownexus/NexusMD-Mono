// What each side of a conflict is to the person resolving it. conflictLabels() names the sides by git's
// left/right; here each also gets its role (incoming = "theirs", or yours = "mine"), a kicker for its
// card, and the take choices that put theirs or mine first. During a rebase the replayed commit (yours)
// is on the right; in a merge, cherry-pick or revert your checkout is on the left.
const QUALIFIERS = {
  rebase: ['already applied', 'being replayed'],
  merge: ['being merged', 'your branch'],
  'cherry-pick': ['being picked', 'your branch'],
  revert: ['the revert', 'your branch'],
}

export function conflictSides(labels, op) {
  const mineSide = op?.kind === 'rebase' ? 'right' : 'left'
  const [inQ, mineQ] = QUALIFIERS[op?.kind] ?? []
  const side = key => {
    const mine = key === mineSide
    const q = mine ? mineQ : inQ
    return {
      ...labels[key], key, role: mine ? 'mine' : 'theirs',
      kicker: `${mine ? 'Yours' : 'Incoming'}${q ? ` · ${q}` : ''}`,
      use: mine ? 'Use mine' : 'Use theirs',
    }
  }
  const left = side('left')
  const right = side('right')
  const theirs = mineSide === 'left' ? right : left
  const mine = mineSide === 'left' ? left : right
  return {
    left, right, theirs, mine,
    // resolveRegion's combined choices, by meaning.
    theirsFirst: mineSide === 'left' ? 'rightFirst' : 'leftFirst',
    mineFirst: mineSide === 'left' ? 'leftFirst' : 'rightFirst',
  }
}
