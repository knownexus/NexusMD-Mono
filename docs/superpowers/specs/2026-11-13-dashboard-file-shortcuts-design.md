# Dashboard shortcuts to a file, folder or document

A Home (phone) / Dashboard (desktop) tile that opens **one particular** git repo file or folder, Markdown document, JSON
document or Editor file or folder, instead of only a whole page. Works on both apps, and the shortcuts sync between them.

## What a shortcut is

A `link` Home widget (`WIDGET_CONFIG_TYPES.link`, `packages/core/src/modules/widgets`) whose config is one target
(`packages/core/src/modules/shortcuts`):

| target | config |
| --- | --- |
| `git` | `{ kind: 'file'\|'folder', path, branch?, repo: { provider, name, fullName?, project?, remote? } }` |
| `doc` | `{ tool: 'markdown'\|'json', docId, name }` |
| `editor` | `{ kind, path, name, platform: 'mobile'\|'desktop' }` |

Plus an optional `label`. `readTarget` cleans any config (they arrive by sync, so nothing in one is trusted).
The widget id is a hash of the target, so pinning the same place twice replaces rather than duplicates.

## Across devices

`homeWidgets` is in `TWEAK_ACCOUNT_FIELDS`, so every Home widget now syncs. (It was device-level; because the field is also
what `wasDeviceLevelInM1` reads, a first sync where both sides already hold different widgets raises a conflict instead of
silently taking the other side's. The list is one synced value, so two devices editing at once is last-write-wins.)

A git target names the repository by identity, never by anything local:

- a clone of a GitHub repo is `github` + `owner/name`, whatever its folder is called (`cloneRepoIdentity`);
- any other clone is `local` + its folder name + its **normalized** remote;
- the phone's own repos are `github` (`owner/name`) or `ado` (`project`/`name`).

`resolveRepo` matches by remote or provider identity (an Azure DevOps remote also yields the phone's `project/name` key),
else by name when exactly one repo has it. Remotes are stored only in normalized form (`host/owner/name`, credentials
stripped, lower case): a raw clone URL can carry a token and this config syncs.

A shortcut a device cannot open is **greyed out and says why on tap** instead of going anywhere: repo not on this device,
document gone, Editor path made on the other kind of device (Editor paths are real disk paths on desktop and the virtual
`/editor` workspace on the phone). A desktop clone with no GitHub/Azure DevOps remote is desktop-only.

## Opening

Each destination takes the target once.

- **Phone git:** `window.NexusMDNav.target` → repo found by identity, default branch (or the named one), at the folder, or the
  file inside its folder. The folder is pushed to history first, so back goes file → folder.
- **Phone documents / Editor:** the Documents page remounts on the named document (`openDocId` through `useDocumentAutosave`,
  `MarkdownViewer`, `JsonEditorView`, `DocumentsView`/`DocumentsPhone`); the Editor store opens the path, or Home says it is gone.
- **Desktop** (apps never import each other, so it is all capabilities): `git.listRepos`, `git.listFiles`, `git.openPath`,
  `documents.openDoc`, `editor.openPath`. `git.openPath` selects the worktree (on the shortcut's branch, else main), switches
  to the Files tab and seeds the explorer (`seedExplorerView`: folders open, file picked); a GitHub repo with no local clone
  falls back to the GitHub tab.

## Creating

1. **Pin to Home / Dashboard** from the screen you are looking at. Viewers dispatch one window event (`pinToHome` →
   `nexusmd:pin-shortcut`); the host that owns the widgets (`apps/app/src/app.jsx`, `apps/desktop/src/main.jsx`) listens
   (`listenForPins`), stamps Editor paths with its own platform, and adds the widget or says it is already there. Entry points:
   phone git file + folder, desktop Files tab (local + GitHub, files + folders, context menu), Markdown and JSON documents
   (desktop, tablet, phone), the Editor (desktop, tablet, phone; file + folder).
2. **Add widget → File or folder.** A picker that knows nothing of repos or documents (`packages/ui/src/target-picker.jsx`);
   each app passes `targetSources`. Phone: GitHub/Azure DevOps repos (default branch), documents, Editor workspace. Desktop,
   per installed app: registered repos (browsed from one `git ls-files`, cached 30 s), documents, the OS file/folder dialog.

## Differences from the first plan

- One `nexusmd:pin-shortcut` event instead of `helm:pin-shortcut` + a `dashboard.pin` capability: the shared screens would
  otherwise need to know which app they are in.
- No new git IPC and no `nexusmd:navigate` change on desktop: `adapter.remotes` already returns `git remote -v`, and
  capabilities carry the target.
- The desktop picker lists registered local repos only; a GitHub repo with no clone is pinned from the GitHub tab.
- A pin from the local Files tab omits the branch (it opens the main worktree); a pin from the GitHub tab and from a
  non-default branch on the phone includes it.

## Not done

- External `nexusmd://open/...` links, line/anchor targets, favourites.
- Not tried on a device (Android) or against the split installer layout beyond the unit tests; the desktop flows were driven
  in the real app (`apps/desktop/e2e/dashboard-shortcuts.spec.js`).
