# PR actions (ADO and GitHub) — design

## Intent

Reviewing and finishing a pull request means leaving NexusMD for Azure DevOps or GitHub today. The PR drawer can read a PR, reply to and resolve ADO threads, edit an ADO description, and post GitHub comments, but it cannot approve, reject or merge. This adds those actions for both providers, with the same buttons and the same meaning for each, so a PR can be reviewed and merged without opening a browser.

It comes first because the planned GitHub tab in Git Workspace opens this same drawer, so it gets these actions for free.

## Goals

- Four actions on an open PR, for ADO and GitHub alike:
  - **Approve** — records your approval.
  - **Wait for author** — ADO: the "Waiting for author" vote (-5). GitHub: a "Request changes" review.
  - **Reject** — closes the PR. ADO: abandons it. GitHub: closes it.
  - **Merge** — choose the merge type and whether to delete the source branch, then merge. (ADO calls this completing the PR.)
- The actions appear wherever the PR drawer opens (Work's Pull Requests screen, the dashboard, linked PRs on a work item; later the Git Workspace GitHub tab).

## Non-goals

- Auto-complete, overriding branch policies, bypassing required reviews.
- Editing the merge commit message or title.
- "Approve with suggestions" (ADO vote 5) and resetting a vote to "no vote". (Voting again with another action replaces your vote.)
- Reopening an abandoned or closed PR.
- Any of the Git Workspace GitHub tab (separate design).

## Anti-goals

- A merge or reject that happens without the user confirming it.
- A failure shown as a generic "failed" or an HTTP code when the provider says why (policy, conflict, own PR, missing permission).
- Different buttons or wording for ADO and GitHub PRs.

## Decided with the user

- Actions: approve, wait for author, reject, merge.
- GitHub "Wait for author" = Request changes.
- Reject closes the PR on both: GitHub closes it, ADO abandons it.
- Merge asks for the merge type and whether to delete the source branch.
- Built for both ADO and GitHub.

## My calls (not confirmed by the user)

- **Placement:** buttons in the PR drawer header beside "Open in browser": Approve, Wait for author, Reject, and a primary Merge. Only on PRs whose status is active or draft; merged/abandoned PRs show none. Draft PRs show the review buttons but not Merge (both providers refuse to merge drafts).
- **Confirmation:** Merge opens a small dialog (merge type, delete-branch tick box, Merge / Cancel). Reject asks "Reject and close this pull request?" (ADO wording: abandon). Approve and Wait for author act immediately; voting again replaces the vote.
- **Merge types offered:** GitHub — only the methods the repo allows (`allow_merge_commit`, `allow_squash_merge`, `allow_rebase_merge` from `GET repos/{owner}/{repo}`), defaulting to the first allowed. ADO — merge (no fast-forward), squash, rebase and fast-forward, semi-linear; ADO's own policy check rejects a disallowed one and the message is shown. Delete source branch defaults to on.
- **Request changes body:** GitHub requires a body for "Request changes"; NexusMD sends a fixed one ("Waiting for author — sent from NexusMD") rather than prompting.
- **Who you are:** ADO votes go to `reviewers/{ME.adoId}` (the ID the loader already stores). GitHub reviews are by the token's user.
- **Errors:** each action shows the provider's message in plain words as a toast and leaves the PR as it was. Known cases worded specifically: GitHub own-PR approval (422), merge blocked by policy or required checks, merge conflicts, 403 permission (via the existing GitHub error classes), ADO policy rejection (the `message` from the response).
- **After an action:** the PR in the drawer and lists updates at once (status, your vote), and a data refresh follows. A merged or rejected PR leaves the Active filter as it does after a normal refresh.
- **ADO complete:** reads the PR first for `lastMergeSourceCommit` (required by ADO), then PATCHes `status: 'completed'` with `completionOptions: { mergeStrategy, deleteSourceBranch }`.
- **GitHub merge:** `PUT repos/{r}/pulls/{n}/merge { merge_method }`; then, if ticked and the head branch is in the same repo, `DELETE repos/{r}/git/refs/heads/{branch}`. A failed delete after a successful merge is a warning, not a failure.

## Left to the builder

- Where the action functions live (`ado/pr-actions.js`, `github/pr-actions.js` beside the existing pr-collab files is the expected shape) and how the drawer reaches the ADO http and GitHub client it already uses.
- How the optimistic update reaches the snapshot (patching the PR in place, as work items are patched, or a refresh only).
- Exact button styling, within the drawer header's existing look.
