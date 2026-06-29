# Continuous Profile Sync — Phase 1 (core merge engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure, headless 3-way merge engine + reconciler + content-hash to `@nexusmd/core` that later phases (ui sync runtime, app/desktop wiring) build on to sync planner/notes/team/tweaks across devices.

**Architecture:** A new `modules/sync` in core with three pure files: `hash.js` (stable content hashing), `merge.js` (per-type 3-way merges — rows, key-value, text, set, and a planner-week composite), and `reconcile.js` (decide push/pull/merge/delete per item). Everything is values-in/values-out — no DOM, storage, or network — so it is fully unit-testable and identical across platforms.

**Tech Stack:** JS ESM, Vitest. Reuses `PLANNER_SECTIONS` from `@nexusmd/core`'s planner module.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-29-planner-cloud-sync-design.md`. This plan is **Phase 1 only** (core). UI runtime, triggers, key management, conflict UI, and per-platform wiring are later phases.
- Core stays pure: no `localStorage`, DOM, `fetch`, React, or `Date.now()` inside merge logic — callers pass any needed `modifiedAt`/`prefer`/`from`/`deviceId` context in. (Tests must not depend on wall-clock.)
- Conflict policy (from the spec): rows + text → **keep-both** (loser preserved, never discarded); key-value (tweaks) → **newest-wins** per key via a caller-supplied `prefer`; set (tombstones) → **union**.
- Equality between values is structural, via `contentHash(a) === contentHash(b)`.
- Public API is a contract: every new export is added to the snapshot in `packages/core/tests/public-api.test.js` in the same task.
- Run tests from repo root `C:/repos/NexusMD-Mono`: `npx vitest run packages/core`.
- Match existing core style: ESM, no semicolons (check neighbouring files; the code below omits them to match `modules/profiles/*`).

---

## File Structure

- `packages/core/src/modules/sync/hash.js` — **new.** `stableStringify(value)`, `contentHash(value)`.
- `packages/core/src/modules/sync/merge.js` — **new.** `mergeRows`, `mergeKeyVal`, `mergeText`, `mergeSet`, `mergePlannerWeek`.
- `packages/core/src/modules/sync/reconcile.js` — **new.** `reconcileItem`.
- `packages/core/src/index.js` — **modify.** Barrel-export the 7 new names.
- `packages/core/tests/sync-hash.test.js` — **new.** Hash tests.
- `packages/core/tests/sync-merge.test.js` — **new.** Merge tests (appended per task).
- `packages/core/tests/sync-reconcile.test.js` — **new.** Reconcile tests.
- `packages/core/tests/public-api.test.js` — **modify.** Add the 7 names.

---

### Task 1: Content hash

**Files:**
- Create: `packages/core/src/modules/sync/hash.js`
- Modify: `packages/core/src/index.js`, `packages/core/tests/public-api.test.js`
- Test: `packages/core/tests/sync-hash.test.js`

**Interfaces:**
- Produces: `stableStringify(value) → string` (deterministic JSON with object keys sorted recursively); `contentHash(value) → string` (short hex hash of `stableStringify`, used everywhere as the change-detector and structural-equality primitive). `contentHash(null)` returns the string `"0"`.

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/sync-hash.test.js
import { describe, it, expect } from 'vitest'
import { stableStringify, contentHash } from '../src/index.js'

describe('stableStringify', () => {
  it('orders object keys so equal objects stringify identically', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
    expect(stableStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}')
  })
  it('preserves array order and handles nesting/null', () => {
    expect(stableStringify([3, { y: 1, x: 2 }, null])).toBe('[3,{"x":2,"y":1},null]')
  })
})

describe('contentHash', () => {
  it('is stable across key order and differs for different content', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }))
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }))
  })
  it('maps null/undefined to "0"', () => {
    expect(contentHash(null)).toBe('0')
    expect(contentHash(undefined)).toBe('0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/sync-hash.test.js`
Expected: FAIL — exports not found.

- [ ] **Step 3: Write the implementation**

```js
// packages/core/src/modules/sync/hash.js
// Deterministic structural hashing — the change-detector + equality primitive for
// the sync engine. Pure: no clock, no IO.

export function stableStringify(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

export function contentHash(value) {
  if (value === null || value === undefined) return '0'
  const s = stableStringify(value)
  // FNV-1a 32-bit → hex. Sufficient as a change-detector / equality key.
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
```

- [ ] **Step 4: Add barrel exports**

In `packages/core/src/index.js`, after the `planProfileScopeMigration` export line, add:

```js
export { stableStringify, contentHash } from './modules/sync/hash.js'
export {
  mergeRows, mergeKeyVal, mergeText, mergeSet, mergePlannerWeek,
} from './modules/sync/merge.js'
export { reconcileItem } from './modules/sync/reconcile.js'
```

(The `merge.js`/`reconcile.js` modules are added in Tasks 2–7. To keep Task 1's tests runnable in isolation, you may temporarily export only the `hash.js` line and add the other two lines when their files exist — but include all three by the end of Task 7.)

- [ ] **Step 5: Update the public-API snapshot**

In `packages/core/tests/public-api.test.js`, add to the `EXPECTED` array (near the `planProfileScopeMigration` entry):

```js
  'stableStringify', 'contentHash',
  'mergeRows', 'mergeKeyVal', 'mergeText', 'mergeSet', 'mergePlannerWeek',
  'reconcileItem',
```

(Same note: if running tasks in isolation, add names as their exports land; all 8 names must be present by Task 7. The snapshot test sorts before comparing, so ordering within the array does not matter.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/sync-hash.test.js`
Expected: PASS. (If the barrel/public-api now reference not-yet-created merge/reconcile modules, restrict them to the hash line for now per Steps 4–5 notes.)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/modules/sync/hash.js packages/core/src/index.js packages/core/tests/sync-hash.test.js packages/core/tests/public-api.test.js
git commit -m "feat(core): sync content hashing (stableStringify, contentHash)"
```

---

### Task 2: mergeRows (3-way row merge, keep-both)

**Files:**
- Create: `packages/core/src/modules/sync/merge.js`
- Test: `packages/core/tests/sync-merge.test.js`

**Interfaces:**
- Consumes: `contentHash` from `./hash.js`.
- Produces: `mergeRows(base, local, remote, idKey = 'id') → { merged: object[], conflicts: object[] }`. `base`/`local`/`remote` are arrays of row objects (treat null/undefined as `[]`). A row deleted on one side and unchanged on the other is dropped; a row deleted on one side but **edited** on the other is kept (edit wins) with a conflict; the **same row edited on both** keeps the local version and appends the remote version as a conflict row `{ ...remote, [idKey]: <id>+'__conflict', _conflict: { from } }`. `from` defaults to `'remote'`. Each conflict descriptor: `{ kind: 'row', id, from }`.

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/sync-merge.test.js
import { describe, it, expect } from 'vitest'
import { mergeRows } from '../src/index.js'

const rows = (...r) => r

describe('mergeRows', () => {
  it('keeps additions from both sides', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows({ id: 'a', t: 1 }, { id: 'b', t: 2 })
    const remote = rows({ id: 'a', t: 1 }, { id: 'c', t: 3 })
    const { merged, conflicts } = mergeRows(base, local, remote)
    expect(merged.map(r => r.id).sort()).toEqual(['a', 'b', 'c'])
    expect(conflicts).toEqual([])
  })

  it('takes the remote edit when local is unchanged', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows({ id: 'a', t: 1 })
    const remote = rows({ id: 'a', t: 9 })
    const { merged } = mergeRows(base, local, remote)
    expect(merged).toEqual([{ id: 'a', t: 9 }])
  })

  it('drops a row deleted remotely when local is unchanged', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows({ id: 'a', t: 1 })
    const remote = rows()
    const { merged } = mergeRows(base, local, remote)
    expect(merged).toEqual([])
  })

  it('keeps both when the same row is edited on both sides', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows({ id: 'a', t: 2 })       // local edit
    const remote = rows({ id: 'a', t: 3 })      // remote edit
    const { merged, conflicts } = mergeRows(base, local, remote, 'id')
    expect(merged).toContainEqual({ id: 'a', t: 2 })                       // local kept
    expect(merged).toContainEqual({ id: 'a__conflict', t: 3, _conflict: { from: 'remote' } })
    expect(conflicts).toEqual([{ kind: 'row', id: 'a', from: 'remote' }])
  })

  it('keeps an edit that races a delete (edit wins, conflict noted)', () => {
    const base = rows({ id: 'a', t: 1 })
    const local = rows()                         // local deleted
    const remote = rows({ id: 'a', t: 5 })       // remote edited
    const { merged, conflicts } = mergeRows(base, local, remote)
    expect(merged).toContainEqual({ id: 'a', t: 5 })
    expect(conflicts.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: FAIL — `mergeRows` not found.

- [ ] **Step 3: Write the implementation**

```js
// packages/core/src/modules/sync/merge.js
// Pure 3-way merge strategies for the sync engine. Equality is structural via
// contentHash. Rows + text keep-both on conflict; key-value is newest-wins via a
// caller-supplied `prefer`; sets are unions.
import { contentHash } from './hash.js'
import { PLANNER_SECTIONS } from '../planner/index.js'

const eq = (a, b) => contentHash(a) === contentHash(b)
const asArray = (v) => (Array.isArray(v) ? v : [])
const byId = (arr, idKey) => { const m = new Map(); for (const r of asArray(arr)) m.set(r[idKey], r); return m }

export function mergeRows(base, local, remote, idKey = 'id') {
  const b = byId(base, idKey), l = byId(local, idKey), r = byId(remote, idKey)
  const ids = new Set([...l.keys(), ...r.keys(), ...b.keys()])
  const merged = []
  const conflicts = []
  for (const id of ids) {
    const bv = b.get(id), lv = l.get(id), rv = r.get(id)
    const lChanged = !eq(lv ?? null, bv ?? null)
    const rChanged = !eq(rv ?? null, bv ?? null)
    if (lv && rv) {
      if (eq(lv, rv)) merged.push(lv)
      else if (!lChanged) merged.push(rv)            // only remote edited
      else if (!rChanged) merged.push(lv)            // only local edited
      else {                                         // both edited → keep both
        merged.push(lv)
        merged.push({ ...rv, [idKey]: id + '__conflict', _conflict: { from: 'remote' } })
        conflicts.push({ kind: 'row', id, from: 'remote' })
      }
    } else if (lv && !rv) {
      // remote deleted (or never had). If remote deleted a row local changed → keep local + conflict.
      if (bv && lChanged) { merged.push(lv); conflicts.push({ kind: 'row', id, from: 'remote-delete' }) }
      else if (bv && !lChanged) { /* remote deletion wins → drop */ }
      else merged.push(lv)                            // local add
    } else if (!lv && rv) {
      if (bv && rChanged) { merged.push(rv); conflicts.push({ kind: 'row', id, from: 'local-delete' }) }
      else if (bv && !rChanged) { /* local deletion wins → drop */ }
      else merged.push(rv)                            // remote add
    }
    // both absent → dropped
  }
  return { merged, conflicts }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/sync/merge.js packages/core/tests/sync-merge.test.js
git commit -m "feat(core): mergeRows 3-way row merge (keep-both)"
```

---

### Task 3: mergeKeyVal (per-key, newest-wins)

**Files:**
- Modify: `packages/core/src/modules/sync/merge.js`
- Test: `packages/core/tests/sync-merge.test.js` (append)

**Interfaces:**
- Consumes: `eq` helper + `contentHash` (already in `merge.js`).
- Produces: `mergeKeyVal(base, local, remote, { prefer = 'local' } = {}) → { merged: object, conflicts: object[] }`. `base`/`local`/`remote` are plain objects (null → `{}`). A key changed on only one side takes that side; a key changed on **both** (including delete-vs-edit, where delete = key absent) resolves by `prefer` (`'local'` keeps local's value, `'remote'` keeps remote's); conflicts: `{ kind: 'keyval', key, winner }`. A key whose winning value is `undefined` is omitted from `merged` (deletion).

- [ ] **Step 1: Write the failing test (append)**

```js
import { mergeKeyVal } from '../src/index.js'

describe('mergeKeyVal', () => {
  it('takes each side’s independent key change', () => {
    const base = { theme: 'light', density: 'cozy' }
    const local = { theme: 'dark', density: 'cozy' }     // changed theme
    const remote = { theme: 'light', density: 'compact' } // changed density
    const { merged, conflicts } = mergeKeyVal(base, local, remote)
    expect(merged).toEqual({ theme: 'dark', density: 'compact' })
    expect(conflicts).toEqual([])
  })

  it('resolves a same-key conflict by prefer', () => {
    const base = { theme: 'light' }
    const local = { theme: 'dark' }
    const remote = { theme: 'sepia' }
    expect(mergeKeyVal(base, local, remote, { prefer: 'local' }).merged).toEqual({ theme: 'dark' })
    const r = mergeKeyVal(base, local, remote, { prefer: 'remote' })
    expect(r.merged).toEqual({ theme: 'sepia' })
    expect(r.conflicts).toEqual([{ kind: 'keyval', key: 'theme', winner: 'remote' }])
  })

  it('honors a one-sided deletion', () => {
    const base = { a: 1, b: 2 }
    const local = { a: 1 }            // deleted b
    const remote = { a: 1, b: 2 }
    expect(mergeKeyVal(base, local, remote).merged).toEqual({ a: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: FAIL — `mergeKeyVal` not found.

- [ ] **Step 3: Write the implementation (append to merge.js)**

```js
export function mergeKeyVal(base, local, remote, { prefer = 'local' } = {}) {
  const b = base || {}, l = local || {}, r = remote || {}
  const keys = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])
  const merged = {}
  const conflicts = []
  for (const key of keys) {
    const bv = b[key], lv = l[key], rv = r[key]
    const lChanged = !eq(lv, bv)
    const rChanged = !eq(rv, bv)
    let winner
    if (!lChanged && !rChanged) winner = lv
    else if (lChanged && !rChanged) winner = lv
    else if (!lChanged && rChanged) winner = rv
    else { // both changed
      winner = prefer === 'remote' ? rv : lv
      conflicts.push({ kind: 'keyval', key, winner: prefer })
    }
    if (winner !== undefined) merged[key] = winner
  }
  return { merged, conflicts }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: all PASS (mergeRows + mergeKeyVal).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/sync/merge.js packages/core/tests/sync-merge.test.js
git commit -m "feat(core): mergeKeyVal per-key merge (newest-wins via prefer)"
```

---

### Task 4: mergeText (whole-doc, keep-both)

**Files:**
- Modify: `packages/core/src/modules/sync/merge.js`
- Test: `packages/core/tests/sync-merge.test.js` (append)

**Interfaces:**
- Produces: `mergeText(base, local, remote, { from = 'remote' } = {}) → { merged: string, conflicts: object[] }`. Strings (null → `''`). If both changed from base, returns `local + "\n\n--- conflict from " + from + " ---\n\n" + remote` and one conflict `{ kind: 'text', from }`; otherwise the changed side (or base if neither changed).

- [ ] **Step 1: Write the failing test (append)**

```js
import { mergeText } from '../src/index.js'

describe('mergeText', () => {
  it('takes the changed side when only one changed', () => {
    expect(mergeText('x', 'x', 'y').merged).toBe('y')
    expect(mergeText('x', 'z', 'x').merged).toBe('z')
    expect(mergeText('x', 'x', 'x').merged).toBe('x')
  })
  it('keeps both when both changed', () => {
    const { merged, conflicts } = mergeText('base', 'mine', 'theirs', { from: 'phone' })
    expect(merged).toBe('mine\n\n--- conflict from phone ---\n\ntheirs')
    expect(conflicts).toEqual([{ kind: 'text', from: 'phone' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: FAIL — `mergeText` not found.

- [ ] **Step 3: Write the implementation (append to merge.js)**

```js
export function mergeText(base, local, remote, { from = 'remote' } = {}) {
  const b = base ?? '', l = local ?? '', r = remote ?? ''
  const lChanged = l !== b
  const rChanged = r !== b
  if (lChanged && rChanged && l !== r) {
    return { merged: `${l}\n\n--- conflict from ${from} ---\n\n${r}`, conflicts: [{ kind: 'text', from }] }
  }
  return { merged: lChanged ? l : r, conflicts: [] }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/sync/merge.js packages/core/tests/sync-merge.test.js
git commit -m "feat(core): mergeText whole-document merge (keep-both)"
```

---

### Task 5: mergeSet (union)

**Files:**
- Modify: `packages/core/src/modules/sync/merge.js`
- Test: `packages/core/tests/sync-merge.test.js` (append)

**Interfaces:**
- Produces: `mergeSet(base, local, remote) → { merged: string[], conflicts: [] }`. Union of the three arrays (deduped, deterministic order: first-seen across local then remote then base). Used for monotonic tombstone sets (e.g. `team.removed`).

- [ ] **Step 1: Write the failing test (append)**

```js
import { mergeSet } from '../src/index.js'

describe('mergeSet', () => {
  it('unions ids from both sides without duplicates', () => {
    const { merged, conflicts } = mergeSet(['a'], ['a', 'b'], ['a', 'c'])
    expect(merged.sort()).toEqual(['a', 'b', 'c'])
    expect(conflicts).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: FAIL — `mergeSet` not found.

- [ ] **Step 3: Write the implementation (append to merge.js)**

```js
export function mergeSet(base, local, remote) {
  const out = []
  const seen = new Set()
  for (const arr of [asArray(local), asArray(remote), asArray(base)]) {
    for (const v of arr) if (!seen.has(v)) { seen.add(v); out.push(v) }
  }
  return { merged: out, conflicts: [] }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/sync/merge.js packages/core/tests/sync-merge.test.js
git commit -m "feat(core): mergeSet union merge for tombstone sets"
```

---

### Task 6: mergePlannerWeek (composite by section type)

**Files:**
- Modify: `packages/core/src/modules/sync/merge.js`
- Test: `packages/core/tests/sync-merge.test.js` (append)

**Interfaces:**
- Consumes: `PLANNER_SECTIONS` (already imported), `mergeRows`/`mergeText`/`mergeKeyVal`.
- Produces: `mergePlannerWeek(base, local, remote, { from = 'remote', prefer = 'local' } = {}) → { merged: { data, themes }, conflicts: object[] }`. `base`/`local`/`remote` are `{ data, themes }` (null → `{ data: {}, themes: {} }`). Per `PLANNER_SECTIONS` entry: `table` → `mergeRows`, `textarea` → `mergeText`, `keyval`/`eow` → `mergeKeyVal`. `themes` → `mergeKeyVal`. Conflicts are tagged with `sectionId` (or `'themes'`).

- [ ] **Step 1: Write the failing test (append)**

```js
import { mergePlannerWeek } from '../src/index.js'

describe('mergePlannerWeek', () => {
  it('merges independent edits across section types and tags conflicts', () => {
    // Pick a real table section + a textarea section id from PLANNER_SECTIONS at runtime.
    const base = { data: {}, themes: {} }
    const local = { data: {}, themes: { mon: 'plan A' } }
    const remote = { data: {}, themes: { tue: 'plan B' } }
    const { merged } = mergePlannerWeek(base, local, remote)
    expect(merged.themes).toEqual({ mon: 'plan A', tue: 'plan B' })
  })

  it('keeps both when the same themes key changes on both sides', () => {
    const base = { data: {}, themes: { mon: 'x' } }
    const local = { data: {}, themes: { mon: 'mine' } }
    const remote = { data: {}, themes: { mon: 'theirs' } }
    const { conflicts } = mergePlannerWeek(base, local, remote, { prefer: 'local' })
    expect(conflicts).toContainEqual({ kind: 'keyval', key: 'mon', winner: 'local', sectionId: 'themes' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: FAIL — `mergePlannerWeek` not found.

- [ ] **Step 3: Write the implementation (append to merge.js)**

```js
export function mergePlannerWeek(base, local, remote, { from = 'remote', prefer = 'local' } = {}) {
  const b = base || {}, l = local || {}, r = remote || {}
  const bd = b.data || {}, ld = l.data || {}, rd = r.data || {}
  const data = {}
  const conflicts = []
  for (const sec of PLANNER_SECTIONS) {
    const id = sec.id
    let res
    if (sec.type === 'table') res = mergeRows(bd[id], ld[id], rd[id])
    else if (sec.type === 'textarea') res = mergeText(bd[id], ld[id], rd[id], { from })
    else res = mergeKeyVal(bd[id], ld[id], rd[id], { prefer }) // keyval + eow
    data[id] = res.merged
    for (const c of res.conflicts) conflicts.push({ ...c, sectionId: id })
  }
  const themesRes = mergeKeyVal(b.themes, l.themes, r.themes, { prefer })
  for (const c of themesRes.conflicts) conflicts.push({ ...c, sectionId: 'themes' })
  return { merged: { data, themes: themesRes.merged }, conflicts }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/tests/sync-merge.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/modules/sync/merge.js packages/core/tests/sync-merge.test.js
git commit -m "feat(core): mergePlannerWeek composite merge by section type"
```

---

### Task 7: reconcileItem (decide push/pull/merge/delete)

**Files:**
- Create: `packages/core/src/modules/sync/reconcile.js`
- Test: `packages/core/tests/sync-reconcile.test.js`
- Verify: `packages/core/src/index.js` + `packages/core/tests/public-api.test.js` (the `reconcileItem` export + snapshot name from Task 1 are now satisfied)

**Interfaces:**
- Consumes: `contentHash` from `./hash.js`.
- Produces: `reconcileItem({ base, local, remote, merge }) → { action, value, conflicts }`. `base`/`local`/`remote` are item payloads or `null` (absent). `merge(base, local, remote) → { merged, conflicts }` is the collection's merge fn (only called when both sides changed). `action` is one of `'noop' | 'push' | 'pull' | 'merge' | 'delete-local' | 'tombstone'`. `value` is the payload to write/upload where relevant (else `null`). `conflicts` is `[]` except for `'merge'`.

- [ ] **Step 1: Write the failing test**

```js
// packages/core/tests/sync-reconcile.test.js
import { describe, it, expect } from 'vitest'
import { reconcileItem, mergeKeyVal } from '../src/index.js'

const merge = (b, l, r) => mergeKeyVal(b, l, r, { prefer: 'local' })

describe('reconcileItem', () => {
  it('noop when nothing changed', () => {
    const v = { a: 1 }
    expect(reconcileItem({ base: v, local: v, remote: v, merge }).action).toBe('noop')
  })
  it('push when only local changed', () => {
    const res = reconcileItem({ base: { a: 1 }, local: { a: 2 }, remote: { a: 1 }, merge })
    expect(res.action).toBe('push'); expect(res.value).toEqual({ a: 2 })
  })
  it('pull when only remote changed', () => {
    const res = reconcileItem({ base: { a: 1 }, local: { a: 1 }, remote: { a: 9 }, merge })
    expect(res.action).toBe('pull'); expect(res.value).toEqual({ a: 9 })
  })
  it('merge when both changed', () => {
    const res = reconcileItem({ base: { a: 1 }, local: { a: 1, b: 2 }, remote: { a: 1, c: 3 }, merge })
    expect(res.action).toBe('merge'); expect(res.value).toEqual({ a: 1, b: 2, c: 3 })
  })
  it('push for a brand-new local item', () => {
    const res = reconcileItem({ base: null, local: { a: 1 }, remote: null, merge })
    expect(res.action).toBe('push')
  })
  it('pull for a brand-new remote item', () => {
    const res = reconcileItem({ base: null, local: null, remote: { a: 1 }, merge })
    expect(res.action).toBe('pull')
  })
  it('delete-local when remote tombstoned an unchanged local', () => {
    const res = reconcileItem({ base: { a: 1 }, local: { a: 1 }, remote: null, merge })
    expect(res.action).toBe('delete-local')
  })
  it('tombstone when local deleted an unchanged remote', () => {
    const res = reconcileItem({ base: { a: 1 }, local: null, remote: { a: 1 }, merge })
    expect(res.action).toBe('tombstone')
  })
  it('keeps the edit when delete races edit', () => {
    // local deleted, remote edited → keep remote (pull), do not lose the edit
    const res = reconcileItem({ base: { a: 1 }, local: null, remote: { a: 2 }, merge })
    expect(res.action).toBe('pull'); expect(res.value).toEqual({ a: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/tests/sync-reconcile.test.js`
Expected: FAIL — `reconcileItem` not found.

- [ ] **Step 3: Write the implementation**

```js
// packages/core/src/modules/sync/reconcile.js
// Decide the sync action for a single item from its base/local/remote payloads.
// Pure: the caller supplies the collection's merge fn. null = absent (deleted or
// never existed).
import { contentHash } from './hash.js'

export function reconcileItem({ base, local, remote, merge }) {
  const hb = contentHash(base)
  const hl = contentHash(local)
  const hr = contentHash(remote)
  const localPresent = local !== null && local !== undefined
  const remotePresent = remote !== null && remote !== undefined
  const basePresent = base !== null && base !== undefined
  const localChanged = hl !== hb
  const remoteChanged = hr !== hb

  if (localPresent && remotePresent) {
    if (!localChanged && !remoteChanged) return { action: 'noop', value: null, conflicts: [] }
    if (localChanged && !remoteChanged) return { action: 'push', value: local, conflicts: [] }
    if (!localChanged && remoteChanged) return { action: 'pull', value: remote, conflicts: [] }
    const { merged, conflicts } = merge(base, local, remote)
    return { action: 'merge', value: merged, conflicts }
  }

  if (localPresent && !remotePresent) {
    // remote absent: a remote tombstone (base existed) or a brand-new local add.
    if (basePresent && !localChanged) return { action: 'delete-local', value: null, conflicts: [] }
    return { action: 'push', value: local, conflicts: [] }   // local add, or remote-deleted-but-local-edited (keep local)
  }

  if (!localPresent && remotePresent) {
    // local absent: a local tombstone (base existed) or a brand-new remote add.
    if (basePresent && !remoteChanged) return { action: 'tombstone', value: null, conflicts: [] }
    return { action: 'pull', value: remote, conflicts: [] }   // remote add, or local-deleted-but-remote-edited (keep remote)
  }

  return { action: 'noop', value: null, conflicts: [] }       // both absent
}
```

- [ ] **Step 4: Ensure the full barrel + snapshot are complete**

Confirm `packages/core/src/index.js` exports all of: `stableStringify, contentHash, mergeRows, mergeKeyVal, mergeText, mergeSet, mergePlannerWeek, reconcileItem` (Task 1 Step 4), and `packages/core/tests/public-api.test.js` `EXPECTED` contains all 8 names.

- [ ] **Step 5: Run the full core suite**

Run: `npx vitest run packages/core`
Expected: all core tests PASS (existing + sync-hash + sync-merge + sync-reconcile + public-api snapshot).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/modules/sync/reconcile.js packages/core/src/index.js packages/core/tests/sync-reconcile.test.js packages/core/tests/public-api.test.js
git commit -m "feat(core): reconcileItem sync action decision + complete sync barrel"
```

---

## Self-Review Notes

- **Spec coverage (Phase 1):** `mergeRows` (table rows + team.custom, keep-both) ✓; `mergeKeyVal` (tweaks, newest-wins via `prefer`) ✓; `mergeText` (notes + planner free-text, keep-both) ✓; `mergeSet` (team.removed tombstones, union) ✓; `mergePlannerWeek` (composite by `PLANNER_SECTIONS` type) ✓; `reconcileItem` (push/pull/merge/delete-local/tombstone/noop incl. delete-vs-edit keeps the edit) ✓; `contentHash`/`stableStringify` (change-detector + structural equality) ✓. Out of scope by design: the ui sync runtime, cloud transport, manifest/tombstone files, key management, triggers, conflict UI, per-platform wiring (Phases 2–5).
- **Purity:** no `Date.now()`/storage/DOM/network in any function; newest-wins is delegated to the caller's `prefer` flag (filled from the manifest `modifiedAt`/`deviceId` in Phase 2), keeping Phase 1 clock-free and deterministic.
- **Type consistency:** `{ merged, conflicts }` shape is uniform across all merge fns; `reconcileItem` returns `{ action, value, conflicts }`; conflict descriptors carry `kind` (`row`/`keyval`/`text`) and merge composites add `sectionId`. `idKey` defaults to `'id'`. The 8 exported names match between barrel, snapshot, and tasks.
- **No placeholders:** every code step contains complete code.
- **Note on barrel/snapshot during isolated runs:** Task 1 introduces all three barrel lines + 8 snapshot names; if a task is executed in isolation before later modules exist, restrict the barrel/snapshot to the landed exports and complete them by Task 7 (called out in Task 1 Steps 4–5 and re-verified in Task 7 Step 4).
