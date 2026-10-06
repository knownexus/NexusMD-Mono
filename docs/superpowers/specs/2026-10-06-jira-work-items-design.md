# Jira Work Items — Design

**Date:** 2026-10-06
**Status:** Approved design, pending implementation plan
**Prerequisite:** `docs/superpowers/plans/2026-08-26-ado-dynamic-metadata.md` (Phase 0)

## Goal

Add Jira Cloud as a second work-item provider alongside Azure DevOps. Both can be configured at once in one profile. A display-mode toggle switches the Work Items view between **merged** (one list/board containing ADO and Jira items) and **separate** (one tab per provider). Jira gets full parity with ADO: list/board, detail, comments, drag-to-transition, inline edits, bulk actions, and creating issues.

## Decisions

| Topic | Decision |
|---|---|
| Relationship to ADO | Both providers active together; toggle between merged and separate views |
| Jira scope | Full parity, including create |
| Deployment / auth | Jira Cloud only (`https://<site>.atlassian.net`), Basic auth with `email:apiToken` |
| Platforms | Desktop (Electron) first; web and Android in later phases on the same core/ui code |
| Architecture | Provider layer in `@nexusmd/core`; ADO wrapped as one provider, Jira added as another |
| PRs / builds / tests | Stay ADO-only; Jira supplies work items only |

## Phasing

- **Phase 0:** implement the existing ADO dynamic metadata plan. This spec relies on its `TYPES`, `PRIORITIES`, `WI_TYPE_STATES` and state-category output.
- **Phase 1 (this spec):** desktop. Provider layer, ADO provider adapter, `jira` module, desktop jira client and settings card, Work Items view in both modes, routed detail/comments/edits, generic create drawer with Jira create, and downstream modules switched to `stateCategory`.
- **Phase 2:** web. `JiraController` proxy (GET/POST/PUT, token held server-side) and web settings. Also implements the missing ADO work-item write proxy, since web needs the same routed source.
- **Phase 3:** Android (`apps/app`) jira client and settings.

Phases 2 and 3 each get their own short spec and plan.

### Out of scope (v1)

- Jira Data Center / Server and Personal Access Tokens
- Atlassian OAuth 2.0 (3LO)
- Linking PRs to Jira issue keys (`prs` is `[]` for Jira items)
- Jira-specific views (backlog ranking, epic roadmap)
- Webhooks / real-time updates (polling at `refreshSecs`, as with ADO)

## 1. Architecture

### 1.1 `packages/core/src/modules/workitems/`

- `provider.js` defines the provider contract (JSDoc typedef plus a `assertProvider` helper used in tests):

  ```js
  {
    id: 'ado' | 'jira',
    label: string,
    isConfigured(config) → boolean,
    load(config, { http, storage }, { isRefresh, priorData }) → { items, meta, people },
    loadDetail(item)            → { description, acceptanceCriteria, reproSteps },
    loadComments(item)          → [{ id, author, text, createdDate }],
    addComment(item, html)      → { id, author, text, createdDate },
    updateFields(item, patch)   → void   // patch: { title?, assignee?, priority?, tags?, points?, description?, ... }
    transition(item, targetState) → void
    availableTargetStates(item) → string[]   // optional; used to dim board columns
    loadRawFields(item)         → { fields, names? },
    getCreateMeta(projectKey)   → CreateMeta,
    create(projectKey, draft)   → { id, displayId },
    webUrl(item)                → string,
  }
  ```

  All item arguments are internal items (with `source`, `id`, `displayId`, `project`), not raw ids.

- `aggregate.js`: `loadWorkItems(providers, configs, adapters, opts)` runs each configured provider's `load` in parallel with `Promise.allSettled`. It:
  - prefixes ids (`ado:123`, `jira:ABC-12`) and stamps `source` on every item;
  - publishes `WORK_ITEMS` (merged), `WORK_ITEMS_BY_SOURCE`, `TYPES` / `STATES` / `PRIORITIES` / `WI_TYPE_STATES` (merged, each entry tagged with `source`), merged `TEAM`, and `WORK_ITEM_PROVIDERS` (`[{ id, label, status: 'ok' | 'error' | 'stale', error?, loadedAt }]`);
  - on a provider failure, keeps that provider's previous items from `priorData` and marks it `stale`.

- `index.js`: provider registry (`registerProvider`, `getProvider(id)`, `getProviders()`) and barrel exports. Re-exported from `packages/core/src/index.js`.

### 1.2 ADO as a provider

`packages/core/src/modules/ado/provider.js` adapts the existing work-item code to the contract. `loader.js` remains the source of ADO data, and ADO PR/build/test loading is unchanged. The desktop write and create code (`apps/desktop/src/ado-workitem-types.js`, `submitNewWorkItem`) moves behind `updateFields`, `transition`, `getCreateMeta` and `create`. ADO's create-meta keeps `TYPE_LAYOUTS` so the ADO drawer looks exactly as it does today.

Every item gains `displayId` (`#123` for ADO, `ABC-12` for Jira). The UI shows `displayId`; internal lookups use the prefixed `id`.

### 1.3 `packages/core/src/modules/jira/`

- `config.js`: `makeJiraConfig({ storage, key })` with `site`, `email`, `apiToken`, `projectKeys[]`, `jql` (optional), `refreshSecs`, `enabled`. `isJiraConfigured()` requires site, email, token and at least one project key. `normaliseSite()` turns `yoursite` or a full URL into `https://yoursite.atlassian.net`.
- `metadata.js`, `loader.js`, `mappers.js`, `adf.js`: see section 2.
- `provider.js`: implements the contract (sections 2 and 3).
- Registered as a module with `requiredAdapters: ['jiraHttp']` and `defaultEnabled: false`, so profiles that don't use Jira see no change.

### 1.4 Transport

Same injected-`http` pattern as ADO: `{ fetch(path, opts) }` taking paths relative to the site root (`rest/api/3/...`, `rest/agile/1.0/...`).

- Desktop: `apps/desktop/src/jira-client.js` calls `https://<site>.atlassian.net/<path>` directly with `Authorization: Basic base64(email:apiToken)` and `Accept: application/json`.
- Web (Phase 2): proxy through `/api/jira/<path>`. Android (Phase 3): its own direct client.

### 1.5 UI seam

`packages/ui/src/views/work-item-source.js` becomes a router: each operation takes an item and calls `getProvider(item.source)`. Platforms register providers (with their adapters bound) instead of supplying an ADO-only source. `apiWorkItemSource` stays as the ADO provider's web transport until Phase 2.

`view-workitems.jsx` stops calling ADO directly: `patchWorkItem` and drag-to-state go through `updateFields` and `transition`.

### 1.6 Display mode

Per-profile setting `workItems.displayMode: 'merged' | 'separate'` (default `merged`), set in settings and mirrored by a toolbar toggle in the Work Items view.

## 2. Jira loading, metadata and mapping

### 2.1 Metadata (`jira/metadata.js`)

Fetched on each full load and reused from `priorData._jiraMeta` on refresh. Every call fails soft.

| Call | Produces |
|---|---|
| `GET rest/api/3/project/{key}/statuses` | issue types per project; statuses per type with `statusCategory.key`. Becomes `TYPES`, `WI_TYPE_STATES`, `stateCategoryByName` |
| `GET rest/api/3/priority` | ordered priority names (highest first). Rank = index + 1 |
| `GET rest/api/3/field` | discovered field ids: story points (name `Story point estimate` or `Story Points`), sprint (schema custom `com.pyxis.greenhopper.jira:gh-sprint`), acceptance criteria (name `Acceptance Criteria`, optional), repro steps (name `Steps to Reproduce`, optional) |
| `GET rest/api/3/myself` | current user |
| `GET rest/api/3/user/assignable/multiProjectSearch?projectKeys=…` | assignable people (`displayName`, `accountId`, avatar) |

Status category mapping onto the ADO plan's categories: `new` → `Proposed`, `indeterminate` → `InProgress`, `done` → `Completed`.

If metadata fails, types and statuses are derived from the loaded issues themselves (each issue's `issuetype` and `status.statusCategory`) so the board still renders.

### 2.2 Issues (`jira/loader.js`)

- Active: `POST rest/api/3/search/jql` with
  `project in (<KEYS>) AND statusCategory != Done [AND (<user jql>)] ORDER BY updated DESC`,
  paging on `nextPageToken`, requesting only the mapped fields plus the discovered custom field ids.
- Recently resolved (for digest): `project in (<KEYS>) AND statusCategory = Done AND resolved >= -14d [AND (<user jql>)]`.
- Sprint dates: when issues reference an active sprint, `GET rest/agile/1.0/board?projectKeyOrId=<key>` then `GET rest/agile/1.0/board/{id}/sprint?state=active` supply start/end dates.
- Cache key `nexusmd.jira.cache.v1`; cache is discarded if the stored `site` differs from config.
- HTTP 429: retry once after `Retry-After` (capped at 10 s), then fail.

### 2.3 Mapping (`jira/mappers.js`)

`mapJiraIssue(issue, { meta, nameToId })` returns the same internal model as ADO's `mapWorkItem`:

| Internal | Jira |
|---|---|
| `id` / `displayId` | `jira:<key>` / `<key>` |
| `source` | `'jira'` |
| `type` | `slugify(fields.issuetype.name)` |
| `title` | `fields.summary` |
| `project` | `fields.project.key` |
| `state` | `fields.status.name` |
| `stateCategory` | from `meta.stateCategoryByName`, else `fields.status.statusCategory.key` mapped as in 2.1 |
| `assignee` | team id from `fields.assignee.displayName` (null if unassigned) |
| `assigneeAccountId` | `fields.assignee.accountId` |
| `priority` / `priorityName` | rank from `meta.priorities` (default 3 when missing) / `fields.priority.name` |
| `points` | `fields[meta.fieldIds.storyPoints]` |
| `tags` | `fields.labels` |
| `sprint` / `iterationPath` | active (else latest) sprint name from `fields[meta.fieldIds.sprint]` |
| `areaPath` | `fields.components[].name` joined with `, ` |
| `comments` | `fields.comment.total` |
| `prs` | `[]` |
| `isNew` | created within the last 24 h (same rule as ADO) |

People: Jira assignable users are merged into `TEAM` by display name. A person present in both providers keeps one team entry with both identities (`adoName`, `jiraAccountId`).

### 2.4 Rich text (`jira/adf.js`)

Jira Cloud stores rich text as Atlassian Document Format (ADF).

- Read: detail and comments request Jira's rendered HTML (`expand=renderedFields` on the issue, `expand=renderedBody` on comments). The existing HTML viewer is reused unchanged.
- Write: `htmlToAdf(html)` supports paragraphs, headings h1–h6, ordered/unordered lists (nested), bold, italic, underline, strike, inline code, code blocks, links and line breaks. Unsupported elements are reduced to their text content rather than rejected.

## 3. Writes, transitions and create

### 3.1 Field edits

`updateFields(item, patch)` → `PUT rest/api/3/issue/{key}` with `{ fields }`:

| Patch key | Jira field |
|---|---|
| `title` | `summary` |
| `description` | `description` (ADF via `htmlToAdf`) |
| `assignee` | `assignee: { accountId }` (null to unassign) |
| `priority` | `priority: { name }` |
| `tags` | `labels` |
| `points` | discovered story-points field id |

The assignee picker for a Jira item lists only Jira-assignable people (those with `jiraAccountId`).

### 3.2 Transitions

Jira moves issues through workflow transitions rather than setting status directly.

- `transition(item, targetState)`: `GET rest/api/3/issue/{key}/transitions`, pick the transition whose `to.name` equals `targetState` (case-insensitive), then `POST .../transitions` with `{ transition: { id } }`.
- No matching transition: no request is sent; the call throws `No transition from "<current>" to "<target>" in this workflow`. The card snaps back and the message is shown as a toast.
- `availableTargetStates(item)` returns the reachable `to.name` values. On a Jira-only board (separate mode, Jira tab) the view calls it at drag start and dims unreachable columns.

### 3.3 Comments and raw fields

- `addComment`: `POST rest/api/3/issue/{key}/comment` with `{ body: htmlToAdf(html) }`.
- `loadRawFields`: `GET rest/api/3/issue/{key}?expand=names`; the inspector shows `names[key]` next to `customfield_*` keys.

### 3.4 Optimistic updates and bulk actions

All edits update the local item and cache immediately and revert with a toast if the request fails (existing pattern, now routed through the provider). Bulk actions group the selection by `source`; mixed selections work, and partial failures are listed per item.

### 3.5 Create

The desktop drawer (`apps/desktop/src/create-work-item-drawer.jsx`) consumes a normalised create-meta from the selected provider:

```js
CreateMeta = {
  projects: [{ key, name }],
  types: [{ id, name, layout?, fields: [{ key, name, required, kind, allowedValues? }] }],
}
// kind ∈ 'text' | 'richtext' | 'number' | 'date' | 'option' | 'multi-option'
//        | 'user' | 'labels' | 'sprint' | 'parent'
```

- **ADO**: built from the existing `ado-workitem-types.js` logic; `layout` carries `TYPE_LAYOUTS` so the ADO drawer is unchanged.
- **Jira**: built from `GET rest/api/3/issue/createmeta/{projectKey}/issuetypes` and `.../issuetypes/{typeId}`. Generic layout: summary, description, assignee, priority, labels, points, sprint, parent/epic first; then other required fields; optional extra fields under a collapsed "More fields" section.
- A required field whose kind the drawer can't render: the drawer names the field and offers **Open in Jira** instead of submitting.
- `create(projectKey, draft)`: `POST rest/api/3/issue`. Then:
  - attachments: `POST rest/api/3/issue/{key}/attachments` (multipart, header `X-Atlassian-Token: no-check`);
  - links: `POST rest/api/3/issueLink`, with link types from `GET rest/api/3/issueLinkType`.
- When both providers are configured, the drawer header shows a provider + project picker. Default: the active tab in separate mode, otherwise the last used. The planner's `helm:create-wi` event pre-fills the same drawer for either provider.

## 4. Settings, views and downstream modules

### 4.1 Desktop settings

New `JiraConnectionCard` beside `AdoConnectionCard` in `apps/desktop/src/desktop-settings.jsx`:

- Site, Email, API token (with a link to Atlassian's API token page).
- **Test connection** → `GET rest/api/3/myself`, showing "Connected as <displayName>".
- Project keys: multi-select populated from `GET rest/api/3/project/search` after a successful test.
- Advanced: optional JQL filter.
- Stored in localStorage under `jira.*`, namespaced per profile like `ado.*`. The token is handled the same way as the ADO PAT.

A Work Items section in settings holds display mode (Merged / Separate) and an enable toggle per provider.

### 4.2 Work Items view (`packages/ui/src/views/view-workitems.jsx`)

- **Merged**
  - Source badge (ADO / Jira) on rows and cards; ids shown as `displayId`.
  - Board columns are state categories (Proposed / In Progress / Resolved / Completed). Each card shows its real state name as a chip. Dropping a card in a category column transitions it to that provider's first state in the category for the item's type; for Jira, the first such state reachable by a transition.
  - Type, Priority and State filters list values from both providers, grouped by source.
- **Separate**
  - Tab strip (ADO | Jira) over the same table and board.
  - Each tab's board uses the provider's real state names as columns (today's ADO behaviour; Jira uses its per-project status list).
- Toolbar shows a provider status pill per provider from `WORK_ITEM_PROVIDERS`.

### 4.3 Detail view (`packages/ui/src/views/work-item-detail.jsx`)

Header gains the source badge and an "Open in ADO / Jira" link from `webUrl(item)`. Acceptance criteria and repro steps sections render for Jira only when the matching custom fields were discovered. The fields editor uses `updateFields`; the raw fields inspector uses `loadRawFields`.

### 4.4 Downstream modules

Triage, digest, team, dashboard and the planner's work-item queue consume `WORK_ITEMS`, which is always the **merged** list regardless of display mode (display mode only affects the Work Items view).

- Where they classify state with `isTerminalState` / `stateCategory`, they use `item.stateCategory` first and fall back to the regex — the same rule as the ADO plan.
- Team view matches people across providers by display name.

## 5. Error handling

- Providers load independently. A Jira failure (401, 403, network) leaves ADO items loaded; the status pill shows e.g. "Jira: auth failed — check settings" and cached Jira items remain visible, marked stale.
- 401 / 403 → message pointing to settings. 404 on a project key → names the key. 429 → one retry, then error.
- Write failures revert optimistically and show Jira's `errorMessages` / `errors` content (first 200 characters).
- Metadata failures fall back to issue-derived types and statuses (2.1).

## 6. Testing

Vitest, TDD, following `packages/core/tests/`. A fake `http` adapter replays recorded Jira JSON fixtures in `packages/core/tests/jira/fixtures/`.

- `jira/mappers.test.js`: every mapped field, missing fields, priority rank, status category mapping.
- `jira/metadata.test.js`: custom field discovery, soft failure, issue-derived fallback.
- `jira/loader.test.js`: JQL construction (with and without user JQL), `nextPageToken` paging, metadata reuse on refresh, cache read/discard.
- `jira/provider.test.js`: transition selection (match, case-insensitive, no match), `updateFields` payload shape, create-meta normalisation, create payload, attachment headers.
- `jira/adf.test.js`: each supported tag, nesting, plain-text fallback.
- `jira/config.test.js`: `normaliseSite`, `isJiraConfigured`.
- `workitems/aggregate.test.js`: id prefixing, merge, one provider failing (stale), `WORK_ITEMS_BY_SOURCE`, `WORK_ITEM_PROVIDERS`.
- `ado/provider.test.js`: existing ADO behaviour unchanged through the adapter.
- UI: `work-item-source` routing by `source`; merged board category columns and drop-target state selection.
- Manual smoke test of desktop against a real Jira Cloud site before Phase 1 is considered done.
