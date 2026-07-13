# PR "Team activity" filter — design

## Problem

The Pull Requests view (`packages/ui/src/views/view-prs.jsx`, shared by web + desktop)
only offers "Needs my review" as a way to see other people's PRs, and that filter
requires you to actually be a listed reviewer with a matching vote
(`effectiveNeedsMe` in `packages/core/src/modules/pr/index.js`). There's no way to
just browse active PRs authored by other people, regardless of reviewer status.

## Scope

Web + desktop only, via the shared `PRView` component in `packages/ui`. The mobile
app (`apps/app`) has its own separate, divergent PR view (segmented control, not
`FilterChip`-based) and is explicitly out of scope for this change.

## Design

### Core logic (`packages/core/src/modules/pr/index.js`)

- Extract the filters common to both "needs me" and the new filter — draft/status/
  conflict/age gates — into a private helper `passesCommonPrFilters(pr, criteria)`.
- Extract the "is this PR mine" check into a private helper `isAuthoredByMe(pr, me)`.
- `effectiveNeedsMe` is refactored to use both helpers; its behavior is unchanged.
- Add a new exported function:

  ```js
  export function effectiveTeamActivity(pr, criteria, me) {
    criteria = criteria || {}
    if (!passesCommonPrFilters(pr, criteria)) return false
    return !isAuthoredByMe(pr, me)
  }
  ```

  Criteria: `includeDrafts`, `onlyActive`, `excludeConflicts`, `minAgeDays` (same
  shape/semantics as the equivalent `effectiveNeedsMe` criteria). No `votes` or
  `excludeMine` field — "not mine" is the filter's whole point, not a toggle.

- Export `effectiveTeamActivity` from `packages/core/src/index.js`.

### UI (`packages/ui/src/views/view-prs.jsx`)

- New persisted state, local to `PRView` (not lifted to `app.jsx`/`main.jsx` —
  nothing outside this view needs it, unlike `needsMeCriteria` which the dashboard
  badge also reads):

  ```js
  const [teamActivityCriteria, setTeamActivityCriteria] =
    usePersisted('nexusmd.pr.teamActivityCriteria', { onlyActive: true })
  ```

- New `TeamActivityCriteriaPopover` component, modeled on
  `NeedsMeCriteriaPopover` but without the vote checkboxes and without "Exclude PRs
  I authored" (implicit). Shows: Include drafts, Exclude conflicts with merge
  conflicts, Only active PRs, Minimum age — same controls/markup pattern as the
  existing popover.
- New `FilterChip` "Team activity" placed after "CI failing", with its own gear
  button opening `TeamActivityCriteriaPopover`, mirroring how "Needs my review"
  pairs with its gear button.
- `counts.teamActivity` added alongside the other counts.
- New `filter === 'teamActivity'` branch in the `filtered` `useMemoPR`, using
  `effectiveTeamActivity(p, teamActivityCriteria, ...)` via a `useEffectiveTeamActivity`
  hook added to `packages/ui/src/data-context.jsx` (mirrors `useEffectiveNeedsMe`,
  injecting `data.ME`).

### Tests

- `packages/core` unit tests: `effectiveTeamActivity` — excludes own PRs, includes
  others' regardless of reviewer/vote state, respects `onlyActive` /
  `includeDrafts` / `excludeConflicts` / `minAgeDays`.
- `packages/ui/tests`: chip switches the visible list to non-mine PRs; gear popover
  toggles persist and affect the filtered results — following the existing PR
  filter test patterns (e.g. `pr-focused-filter.test.jsx`).

## Out of scope

- Mobile app (`apps/app`) PR view.
- Dashboard widget changes — "Team activity" doesn't feed any badge/count outside
  the PR view itself.
