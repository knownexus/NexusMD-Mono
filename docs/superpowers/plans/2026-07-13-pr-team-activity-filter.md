# PR "Team activity" filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Team activity" filter chip to the shared web/desktop Pull Requests view, showing PRs authored by anyone but the current user (independent of reviewer/vote status), with the same kind of configurable criteria popover as "Needs my review".

**Architecture:** Add a new pure filter function `effectiveTeamActivity` to `packages/core`, reusing (via extraction) the draft/status/conflict/age gates already in `effectiveNeedsMe`. Wire it into `packages/ui`'s `PRView` as a new `FilterChip` + settings popover, with its own `usePersisted` criteria state kept local to the view (not lifted to host `app.jsx`/`main.jsx`, since nothing outside `PRView` needs it).

**Tech Stack:** React (JSX, no build step transform beyond existing Vite/vitest setup), Vitest + @testing-library/react for tests.

## Global Constraints

- Scope is web + desktop only, via the shared `packages/ui` `PRView`. The mobile app (`apps/app/src/views/view-prs.jsx`) has its own divergent implementation and is explicitly out of scope.
- `effectiveTeamActivity` criteria shape: `{ includeDrafts, onlyActive, excludeConflicts, minAgeDays }` — no `votes` or `excludeMine` field (exclusion of the current user's own PRs is unconditional, not a toggle).
- Default criteria for the new chip: `{ onlyActive: true }`.
- `effectiveNeedsMe`'s existing behavior and public signature must not change (regression risk: it's used by the dashboard badge and by `apps/app`'s own PR view via `components.jsx`).
- Run tests from each package's own directory (`packages/core`, `packages/ui`), not the repo root — this repo's vitest/jsdom setup doesn't resolve correctly from root.

---

### Task 1: Extract shared PR-filter gates and add `effectiveTeamActivity` in `packages/core`

**Files:**
- Modify: `packages/core/src/modules/pr/index.js` (whole file — refactor `effectiveNeedsMe`, add helpers + `effectiveTeamActivity`)
- Modify: `packages/core/src/index.js:18` (add export)
- Modify: `packages/core/tests/public-api.test.js:23` (add `'effectiveTeamActivity'` to the `EXPECTED` list)
- Test: `packages/core/tests/pr-filters.test.js` (add new `describe` block)

**Interfaces:**
- Produces: `effectiveTeamActivity(pr, criteria, me)` — exported from `@nexusmd/core`. `pr: { status, draft, hasConflicts, author, age }`, `criteria: { includeDrafts?, onlyActive?, excludeConflicts?, minAgeDays? }`, `me: { name } | null | undefined`. Returns `boolean`.

- [ ] **Step 1: Write the failing tests for `effectiveTeamActivity`**

Append to `packages/core/tests/pr-filters.test.js` (add the import and the new `describe` block; keep the existing `effectiveNeedsMe` describe block unchanged):

```js
import { describe, it, expect } from 'vitest'
import { effectiveNeedsMe, effectiveTeamActivity } from '../src/index.js'

const me = { name: 'Alex Doe' }

// ... existing describe('effectiveNeedsMe', ...) block stays as-is ...

describe('effectiveTeamActivity', () => {
  it('excludes PRs authored by me', () => {
    const pr = { author: 'alex-doe' }
    expect(effectiveTeamActivity(pr, {}, me)).toBe(false)
  })

  it('includes PRs authored by someone else, with no reviewer requirement', () => {
    const pr = { author: 'jamie-lee', reviewerDetails: [] }
    expect(effectiveTeamActivity(pr, {}, me)).toBe(true)
  })

  it('excludes drafts unless includeDrafts is set', () => {
    const pr = { author: 'jamie-lee', draft: true }
    expect(effectiveTeamActivity(pr, {}, me)).toBe(false)
    expect(effectiveTeamActivity(pr, { includeDrafts: true }, me)).toBe(true)
  })

  it('onlyActive filters out non-active PRs', () => {
    const pr = { author: 'jamie-lee', status: 'completed' }
    expect(effectiveTeamActivity(pr, { onlyActive: true }, me)).toBe(false)
    expect(effectiveTeamActivity(pr, { onlyActive: true }, me)).toBe(false)
  })

  it('excludeConflicts filters out conflicted PRs', () => {
    const pr = { author: 'jamie-lee', hasConflicts: true }
    expect(effectiveTeamActivity(pr, { excludeConflicts: true }, me)).toBe(false)
  })

  it('minAgeDays requires the PR to be old enough', () => {
    const young = { author: 'jamie-lee', age: '3h' }
    const old   = { author: 'jamie-lee', age: '5d' }
    expect(effectiveTeamActivity(young, { minAgeDays: 2 }, me)).toBe(false)
    expect(effectiveTeamActivity(old,   { minAgeDays: 2 }, me)).toBe(true)
  })

  it('with no known user, nothing is "mine" so everything not otherwise filtered passes', () => {
    const pr = { author: 'jamie-lee' }
    expect(effectiveTeamActivity(pr, {}, null)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run tests/pr-filters.test.js`
Expected: FAIL — `effectiveTeamActivity is not a function` (or similar import error), since it doesn't exist yet.

- [ ] **Step 3: Refactor `effectiveNeedsMe` and add `effectiveTeamActivity`**

Replace the body of `packages/core/src/modules/pr/index.js` from the `effectiveNeedsMe` JSDoc/function onward with:

```js
// Criteria shared by both effectiveNeedsMe and effectiveTeamActivity: draft/status/
// conflict/age gates that don't depend on reviewer state.
function passesCommonPrFilters(pr, criteria) {
  if (!criteria.includeDrafts && pr.draft) return false
  if (criteria.onlyActive && pr.status !== 'active') return false
  if (criteria.excludeConflicts && pr.hasConflicts) return false

  if (criteria.minAgeDays) {
    const a = String(pr.age || '')
    const ageDays = a.endsWith('d') ? (parseInt(a, 10) || 0) : 0
    if (ageDays < criteria.minAgeDays) return false
  }

  return true
}

function isAuthoredByMe(pr, me) {
  const myId = slugify((me && me.name) || '')
  return !!myId && pr.author === myId
}

/**
 * Does this PR need review from the current user, under the given criteria?
 *
 * @param {object} pr        Normalized PR (status, draft, hasConflicts, author, age,
 *                           needsMe, reviewerDetails: [{ name, vote }]).
 * @param {object} [criteria]
 * @param {number[]} [criteria.votes=[0]]   Reviewer vote values that count as "needs me".
 * @param {boolean}  [criteria.includeDrafts]
 * @param {boolean}  [criteria.onlyActive]
 * @param {boolean}  [criteria.excludeConflicts]
 * @param {boolean}  [criteria.excludeMine]
 * @param {number}   [criteria.minAgeDays]
 * @param {object} [me]      Current user, e.g. { name }. Replaces the old global.
 * @returns {boolean}
 */
export function effectiveNeedsMe(pr, criteria, me) {
  criteria = criteria || {}
  const votes = criteria.votes && criteria.votes.length ? criteria.votes : [0]

  if (!passesCommonPrFilters(pr, criteria)) return false
  if (criteria.excludeMine && isAuthoredByMe(pr, me)) return false

  const meName = (me && me.name) || ''
  if (!meName) return !!pr.needsMe
  return (pr.reviewerDetails || []).some((r) => r.name === meName && votes.indexOf(r.vote) !== -1)
}

/**
 * Does this PR represent team activity worth browsing — i.e. it's not one of mine,
 * regardless of whether I'm a listed reviewer? Used by the "Team activity" filter,
 * which is for keeping an eye on others' PRs rather than tracking review requests.
 *
 * @param {object} pr        Normalized PR (status, draft, hasConflicts, author, age).
 * @param {object} [criteria]
 * @param {boolean} [criteria.includeDrafts]
 * @param {boolean} [criteria.onlyActive]
 * @param {boolean} [criteria.excludeConflicts]
 * @param {number}  [criteria.minAgeDays]
 * @param {object} [me]      Current user, e.g. { name }.
 * @returns {boolean}
 */
export function effectiveTeamActivity(pr, criteria, me) {
  criteria = criteria || {}
  if (!passesCommonPrFilters(pr, criteria)) return false
  return !isAuthoredByMe(pr, me)
}
```

Leave the file's existing header comment and `import { slugify } from '../ado/helpers.js'` at the top untouched.

- [ ] **Step 4: Export `effectiveTeamActivity` from the package**

In `packages/core/src/index.js:18`, change:

```js
export { effectiveNeedsMe } from './modules/pr/index.js'
```

to:

```js
export { effectiveNeedsMe, effectiveTeamActivity } from './modules/pr/index.js'
```

- [ ] **Step 5: Update the public-API snapshot test**

In `packages/core/tests/public-api.test.js:23`, change:

```js
  'derivePrSparkline', 'deriveProjects', 'deriveSprint', 'effectiveNeedsMe',
```

to:

```js
  'derivePrSparkline', 'deriveProjects', 'deriveSprint', 'effectiveNeedsMe', 'effectiveTeamActivity',
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run tests/pr-filters.test.js tests/public-api.test.js`
Expected: PASS (all tests in both files).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/pr/index.js packages/core/src/index.js packages/core/tests/pr-filters.test.js packages/core/tests/public-api.test.js
git commit -m "feat(core): add effectiveTeamActivity PR filter"
```

---

### Task 2: Add `useEffectiveTeamActivity` hook in `packages/ui`

**Files:**
- Modify: `packages/ui/src/data-context.jsx` (add hook after `useEffectiveNeedsMe`)

**Interfaces:**
- Consumes: `effectiveTeamActivity(pr, criteria, me)` from `@nexusmd/core` (Task 1).
- Produces: `useEffectiveTeamActivity()` — a hook, same shape as `useEffectiveNeedsMe`, returning a memoized `(pr, criteria) => boolean` callback bound to `data.ME` from context.

- [ ] **Step 1: Add the hook**

In `packages/ui/src/data-context.jsx`, change the import on line 10 from:

```js
import { effectiveNeedsMe as coreEffectiveNeedsMe } from '@nexusmd/core'
```

to:

```js
import {
  effectiveNeedsMe as coreEffectiveNeedsMe,
  effectiveTeamActivity as coreEffectiveTeamActivity,
} from '@nexusmd/core'
```

Then, immediately after the existing `useEffectiveNeedsMe` function (after its closing `}` around line 97), add:

```js

/**
 * PR "team activity" filter bound to the current user. Mirrors useEffectiveNeedsMe.
 */
export function useEffectiveTeamActivity() {
  const { data } = useNexusData()
  const me = data.ME
  return React.useCallback((pr, criteria) => coreEffectiveTeamActivity(pr, criteria, me), [me])
}
```

There is no test file dedicated to `data-context.jsx` hooks in isolation — this hook is exercised end-to-end by the `PRView` tests in Task 3, so no standalone test is written here.

- [ ] **Step 2: Sanity-check the file parses**

Run: `cd packages/ui && npx vitest run tests/views.test.jsx`
Expected: PASS (existing `PRView` test still renders correctly — confirms the `data-context.jsx` edit didn't break the module).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/data-context.jsx
git commit -m "feat(ui): add useEffectiveTeamActivity hook"
```

---

### Task 3: Add the "Team activity" chip + popover to `PRView`

**Files:**
- Modify: `packages/ui/src/views/view-prs.jsx`
- Test: `packages/ui/tests/pr-team-activity-filter.test.jsx` (new)

**Interfaces:**
- Consumes: `useEffectiveTeamActivity()` from `packages/ui/src/data-context.jsx` (Task 2); `usePersisted` from `../app-components.jsx` (existing); `FilterChip` from `../components.jsx` (existing).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/tests/pr-team-activity-filter.test.jsx`:

```jsx
import { it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { NexusDataProvider, PRView } from '../src/index.js'

afterEach(cleanup)

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }
}

const PRS = [
  { id: 1, title: 'My PR', status: 'active', branch: 'a', age: '1d', author: 'me', authorName: 'Me', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: null },
  { id: 2, title: 'Alice PR', status: 'active', branch: 'b', age: '1d', author: 'alice', authorName: 'Alice', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: null },
  { id: 3, title: 'Alice draft PR', status: 'draft', draft: true, branch: 'c', age: '1d', author: 'alice', authorName: 'Alice', additions: 0, deletions: 0, reviewerDetails: [], linkedWorkItems: [], comments: 0, unresolvedComments: 0, ciStatus: null },
]

function renderView(storageSeed) {
  const storage = memStorage(storageSeed)
  return render(
    <NexusDataProvider value={{
      storage, getProfileKey: k => k, pushPref: () => {},
      data: { ORG: 'o', TEAM: [], ME: { id: 'me', name: 'Me', initials: 'ME' } },
    }}>
      <PRView prs={PRS} onOpen={() => {}} needsMeCriteria={{ votes: [0] }} setNeedsMeCriteria={() => {}} />
    </NexusDataProvider>
  )
}

it('Team activity chip shows active PRs not authored by me, excluding drafts by default', () => {
  const { container, getByText } = renderView({ 'nexusmd.pr.filter': JSON.stringify('all') })
  fireEvent.click(getByText('Team activity'))
  expect(container.textContent).toContain('Alice PR')
  expect(container.textContent).not.toContain('My PR')
  expect(container.textContent).not.toContain('Alice draft PR')
})

it('Team activity gear popover toggles Include drafts and the list updates', () => {
  const { container, getByText, getAllByTitle } = renderView({ 'nexusmd.pr.filter': JSON.stringify('all') })
  fireEvent.click(getByText('Team activity'))
  fireEvent.click(getAllByTitle('Customise criteria')[1])
  fireEvent.click(getByText('Include drafts'))
  expect(container.textContent).toContain('Alice draft PR')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/ui && npx vitest run tests/pr-team-activity-filter.test.jsx`
Expected: FAIL — `getByText('Team activity')` / `getAllByTitle('Customise criteria')[1]` not found, since the chip doesn't exist yet.

- [ ] **Step 3: Add the `TeamActivityCriteriaPopover` component**

In `packages/ui/src/views/view-prs.jsx`, after the closing `}` of `NeedsMeCriteriaPopover` (currently ending at line 81, right before `export function PRView`), add:

```jsx
function TeamActivityCriteriaPopover({ criteria, onChange, onClose }) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, boxShadow: 'var(--shadow-pop)', padding: '10px 12px', width: 252,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Team activity filters
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.includeDrafts}
          onChange={() => onChange({ ...criteria, includeDrafts: !criteria.includeDrafts })} style={{ margin: 0 }}/>
        Include drafts
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.excludeConflicts}
          onChange={() => onChange({ ...criteria, excludeConflicts: !criteria.excludeConflicts })} style={{ margin: 0 }}/>
        Exclude PRs with merge conflicts
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer', padding: '3px 0' }}>
        <input type="checkbox" checked={!!criteria.onlyActive}
          onChange={() => onChange({ ...criteria, onlyActive: !criteria.onlyActive })} style={{ margin: 0 }}/>
        Only active PRs
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '5px 0 2px' }}>
        <span>Minimum age</span>
        <select value={criteria.minAgeDays || 0}
          onChange={(e) => onChange({ ...criteria, minAgeDays: parseInt(e.target.value, 10) || 0 })}
          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer' }}>
          <option value={0}>Any</option>
          <option value={1}>&ge; 1 day</option>
          <option value={3}>&ge; 3 days</option>
          <option value={7}>&ge; 7 days</option>
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 4: Wire state, counts, and filtering into `PRView`**

In `packages/ui/src/views/view-prs.jsx`, inside `export function PRView(...)`:

1. Add the effective-filter hook next to the existing one (near line 85, after `const effectiveNeedsMe = useEffectiveNeedsMe()`):

```js
  const effectiveTeamActivity = useEffectiveTeamActivity()
```

And add `useEffectiveTeamActivity` to the import from `../data-context.jsx` (line 8):

```js
import { useNexusData, useEffectiveNeedsMe, useEffectiveTeamActivity } from '../data-context.jsx'
```

2. Add persisted criteria state and popover-visibility state next to the existing `showCriteriaPopover` (near line 92):

```js
  const [teamActivityCriteria, setTeamActivityCriteria] = usePersisted('nexusmd.pr.teamActivityCriteria', { onlyActive: true })
  const [showTeamActivityPopover, setShowTeamActivityPopover] = useStatePR(false)
```

3. Add a count in the `counts` object (near line 115-124), after the `needsMe` line:

```js
    needsMe:   prs.filter(p => effectiveNeedsMe(p, criteria)).length,
    teamActivity: prs.filter(p => effectiveTeamActivity(p, teamActivityCriteria)).length,
```

4. Add a filter branch in the `filtered` `useMemoPR` (near line 131-136), after the `needsMe` branch:

```js
    if (filter === 'needsMe') out = out.filter(p => effectiveNeedsMe(p, criteria))
    else if (filter === 'teamActivity') out = out.filter(p => effectiveTeamActivity(p, teamActivityCriteria))
    else if (filter === 'active') out = out.filter(p => p.status === 'active')
```

And add `teamActivityCriteria` to that `useMemoPR`'s dependency array (currently `[prs, filter, search, criteria, focusedWI]`):

```js
  }, [prs, filter, search, criteria, teamActivityCriteria, focusedWI])
```

5. Add the chip + gear button in the filter bar JSX, right after the "Needs my review" chip's closing `</div>` (the block ending at line 206, right before the `<FilterChip active={filter === 'active'} ...>` chip):

```jsx
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <FilterChip active={filter === 'teamActivity'} count={counts.teamActivity} onClick={() => setFilter('teamActivity')}
            icon={<Icon name="team" size={11}/>}>Team activity</FilterChip>
          <button className="btn icon ghost sm" title="Customise criteria"
            style={{ height: 24, width: 24, padding: 0, flexShrink: 0 }}
            onClick={e => { e.stopPropagation(); setShowTeamActivityPopover(v => !v) }}>
            <Icon name="settings" size={11}/>
          </button>
          {showTeamActivityPopover && (
            <TeamActivityCriteriaPopover criteria={teamActivityCriteria} onChange={setTeamActivityCriteria} onClose={() => setShowTeamActivityPopover(false)}/>
          )}
        </div>
```

`packages/ui/src/icons.jsx` already defines a `'team'` icon (two overlapping person glyphs), used above.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/ui && npx vitest run tests/pr-team-activity-filter.test.jsx`
Expected: PASS (both tests).

- [ ] **Step 6: Run the full `packages/ui` and `packages/core` test suites to check for regressions**

Run: `cd packages/ui && npx vitest run`
Run: `cd packages/core && npx vitest run`
Expected: PASS — no existing test broken by the `view-prs.jsx`, `data-context.jsx`, or `pr/index.js` changes.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/views/view-prs.jsx packages/ui/tests/pr-team-activity-filter.test.jsx
git commit -m "feat(ui): add Team activity PR filter chip"
```

---

## Out of scope (confirmed during brainstorming)

- Mobile app (`apps/app`) PR view — separate implementation, not touched.
- Dashboard widget/badge changes — "Team activity" doesn't feed any count outside the PR view.
