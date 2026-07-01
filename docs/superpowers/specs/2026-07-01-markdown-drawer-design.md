# Markdown Support — Work Item & PR Drawer

**Date:** 2026-07-01  
**Status:** Approved

---

## Problem

Two separate issues:

1. **Work item drawer** — `renderContent` in `work-item-detail.jsx` uses a coarse HTML-tag check: if any HTML tag is detected it renders the raw sanitized HTML, bypassing `marked`. ADO often stores plain markdown text wrapped in structural `<div><p>…</p></div>` tags, so markdown syntax (headings, bold, lists) renders as literal characters instead of formatted content. Affects Description and Acceptance Criteria in particular.

2. **PR drawer** — Missing description entirely; comment threads are never fetched (only a count is shown); existing thread display shows only the first comment as plain text with no markdown rendering; the "Add comment" textarea has no markdown support; no ability to reply to or resolve a thread.

---

## Work Item Drawer — Markdown Fix

### Affected files
- `packages/ui/src/views/work-item-detail.jsx` (the shared implementation; `apps/app/src/work-item-detail.jsx` is a re-export shim and needs no changes)

### Approach

Replace the current coarse HTML detection in `renderContent` with a two-phase check:

**Phase 1 — detect real formatting**  
A helper `isOnlyStructural(html)` returns `true` if the HTML contains no "real" formatting tags. The real-formatting tag set is: `b`, `strong`, `i`, `em`, `u`, `s`, `del`, `ul`, `ol`, `li`, `a` (with `href`), `table`, `img`, `h1`–`h6`, `pre`, `code`.

```
isOnlyStructural(html):
  strip all structural tags (div, p, span, br, section, article)
  if any remaining opening tag exists → false
  else → true
```

**Phase 2 — unwrap and parse**  
A helper `stripStructural(html)` converts structural tags to plain text:
- `<br>` and `</p>` and `</div>` → `\n`
- All other structural opening/closing tags → removed
- Result is `.trim()`-ed

New `renderContent`:
```
if value is empty → return "Not set" placeholder
if isOnlyStructural(value):
  plain = stripStructural(value)
  return mdToHtml(plain)         ← markdown path
else:
  return sanitizeHtml(value)     ← rich-HTML path (unchanged)
```

**No changes** to edit mode, `mdToHtml`, saving, or the Discussion component.

---

## PR Drawer — Description, Threads, Reply, Resolve

### Affected file
- `apps/app/src/app.jsx` (the `PRDetail` function and its sub-components)

### Description section

Added to the Overview tab, between the author/status header and the Reviewers section.

- Renders `pr.description` through `renderContent` (same helper as WI drawer, imported or duplicated).
- Hidden when `pr.description` is empty.
- Read-only (no editing).

### Thread fetching

`PRDetail` fires a single GET on mount (and when `pr.id` changes):

```
GET {project}/_apis/git/repositories/{repoId}/pullRequests/{id}/threads?api-version=7.0
```

Stored in local state: `{ status: 'loading' | 'ok' | 'error', threads: [], error: null }`.

- Not part of the background data refresh.
- Only runs while the drawer is open.
- A short inline loading indicator shows inside the Comments section while fetching.

### Thread display

Replaces the current flat comment list. Each thread card shows:

| Element | Detail |
|---|---|
| Status badge | "Open" (yellow) or "Resolved" (green) |
| Resolve / Re-open button | PATCH `threads/{threadId}` `{ status: 'fixed' }` or `{ status: 'active' }` |
| File path | Shown for code comments; "General" for top-level threads |
| All comments | Full list, each with author, `timeAgo` timestamp, content rendered via `renderContent` |
| Reply input | Collapsed by default; toggled with a "Reply" button per thread |

Thread state is held in the local `threads` array. On a successful resolve or reply the relevant thread object is updated in place (optimistic update).

### Reply

Replying to a thread POSTs:

```
POST {project}/_apis/git/repositories/{repoId}/pullRequests/{id}/threads/{threadId}/comments?api-version=7.0
{
  parentCommentId: <id of last comment in thread>,
  content: <text>,
  commentType: 1
}
```

The reply composer is a small inline Write/Preview textarea (no toolbar, same style as WI Discussion). `Ctrl+Enter` submits. On success the new comment is appended to the thread locally.

### Resolve / Re-open

PATCHes the thread status:

```
PATCH {project}/_apis/git/repositories/{repoId}/pullRequests/{id}/threads/{threadId}?api-version=7.0
{ "status": "fixed" }    // resolve
{ "status": "active" }   // re-open
```

On success updates `thread.status` in local state.

### Add comment (new top-level thread)

The existing plain `<textarea>` is replaced with a Write/Preview composer matching the WI Discussion style:
- Write tab: monospace textarea, `Ctrl+Enter` to post
- Preview tab: `renderContent` applied to the draft
- "Markdown supported · Ctrl+Enter to post" hint
- Posts to `threads` endpoint as today (no changes to the POST body)

---

## Out of scope

- Editing PR descriptions
- Fetching threads as part of the background data refresh
- Deleting comments
- Inline code-comment diff context
- Web app (`apps/web`) and desktop (`apps/desktop`) — same patterns apply but are not part of this spec

---

## Files changed

| File | Change |
|---|---|
| `packages/ui/src/views/work-item-detail.jsx` | Replace `renderContent` with `isOnlyStructural` + `stripStructural` helpers |
| `apps/app/src/app.jsx` | `PRDetail`: add description section, thread fetch + state, thread display with reply/resolve, markdown composer |
