// Platform adapter interface shapes — documentation contracts only.
// Apps implement these; core never imports from any app.
// Required adapters (file, http, storage) have no default — apps MUST provide them.
// Optional adapters have isAvailable() → false no-ops as defaults.

export const IFileAdapter = {
  read:              async (path) => Promise.reject(new Error('IFileAdapter.read not implemented')),
  write:             async (path, text) => Promise.reject(new Error('IFileAdapter.write not implemented')),
  exists:            async (path) => Promise.reject(new Error('IFileAdapter.exists not implemented')),
  list:              async (dirPath) => Promise.reject(new Error('IFileAdapter.list not implemented')),
  delete:            async (path) => Promise.reject(new Error('IFileAdapter.delete not implemented')),
  mkdir:             async (dirPath) => Promise.reject(new Error('IFileAdapter.mkdir not implemented')),
  defaultProfileDir: async () => Promise.reject(new Error('IFileAdapter.defaultProfileDir not implemented')),
}

export const IHttpAdapter = {
  fetch: async (url, options) => Promise.reject(new Error('IHttpAdapter.fetch not implemented')),
}

export const IStorageAdapter = {
  get:    (key) => { throw new Error('IStorageAdapter.get not implemented') },
  set:    (key, value) => { throw new Error('IStorageAdapter.set not implemented') },
  remove: (key) => { throw new Error('IStorageAdapter.remove not implemented') },
  keys:   () => { throw new Error('IStorageAdapter.keys not implemented') },
}

// opts: { icon?: string, tag?: string, onClick?: () => void }
export const INotificationAdapter = {
  send: (title, body, opts) => {},
}

export const IPickerAdapter = {
  pickFile:      async (filter) => null,
  pickDirectory: async () => null,
  saveFile:      async (name, text) => {},
}

export const IAuthAdapter = {
  isAvailable:     async () => false,
  promptBiometric: async (reason) => false,
}

export const IClipboardAdapter = {
  read:        async () => '',
  write:       async (text) => {},
  isAvailable: () => false,
}

export const ISecureStorageAdapter = {
  get:    async (key) => null,
  set:    async (key, value) => {},
  remove: async (key) => {},
}

export const INetworkAdapter = {
  isOnline: () => true,
  onChange:  (callback) => () => {},
}

export const ILifecycleAdapter = {
  onForeground: (cb) => () => {},
  onBackground: (cb) => () => {},
}

export const IShareAdapter = {
  share:       async (title, text, url) => {},
  isAvailable: () => false,
}

// TrayMenuItem: { label: string, type?: 'normal'|'separator', enabled?: boolean, click?: () => void }
export const ITrayAdapter = {
  show:           () => {},
  hide:           () => {},
  setTooltip:     (text) => {},
  setContextMenu: (items) => {},
  onActivate:     (cb) => () => {},
  isAvailable:    () => false,
}

export const INavigationAdapter = {
  onBackButton:         (cb) => () => {},
  canGoBack:            () => false,
  goBack:               () => {},
  setBackButtonHandler: (cb) => () => {},
}

export const IThemeAdapter = {
  getColorScheme: () => 'light',
  onChange:       (cb) => () => {},
}

export const IUpdateAdapter = {
  checkForUpdate:    async () => ({ available: false }),
  installUpdate:     async () => {},
  onUpdateAvailable: (cb) => () => {},
}

export const IBadgeAdapter = {
  set:         (count) => {},
  clear:       () => {},
  isAvailable: () => false,
}

export const IDeepLinkAdapter = {
  onLink:      (cb) => () => {},
  isAvailable: () => false,
}

// Runs a JS snippet (pre-request/post-response scripts, test assertions).
// context: plain data the script can read/mutate (e.g. { vars, request }),
// returned as `context` reflecting any mutations; `logs` is reserved for
// captured console output (the desktop implementation currently always
// returns [] — see api-client-script.cjs for why); `error` is set (and
// `context` is null) if the script threw.
//
// SECURITY: this is meant for scripts the user themselves authored (the same
// trust model as Postman/Bruno's own request scripts), not as a boundary
// against untrusted/third-party code — Node's `vm` module (the desktop
// implementation) is explicitly documented as NOT a security mechanism.
export const IScriptRunnerAdapter = {
  run: async (script, context) => Promise.reject(new Error('IScriptRunnerAdapter.run not implemented')),
}

// A plain, unscoped HTTP client for the api-client module — unlike IHttpAdapter,
// which apps may wire to a specific backend (e.g. ADO) with forced auth/URL
// scoping, this must send exactly the request it's given, to any host.
export const IRawHttpAdapter = {
  fetch: async (url, options) => Promise.reject(new Error('IRawHttpAdapter.fetch not implemented')),
}

// Database Manager — desktop-only (real drivers run in the Electron main
// process). Absence from createNoOpAdapters() gates the db-manager module to
// platforms that explicitly supply it.
export const IDbManagerAdapter = {
  isAvailable: () => false,
  connect:     async (type, config) => Promise.reject(new Error('IDbManagerAdapter.connect not implemented')),
  getRows:     async (type, config, table, limit, offset) => Promise.reject(new Error('IDbManagerAdapter.getRows not implemented')),
  deleteRows:  async (type, config, table, primaryKey, values) => Promise.reject(new Error('IDbManagerAdapter.deleteRows not implemented')),
  updateCell:  async (type, config, table, primaryKey, primaryValue, column, value) => Promise.reject(new Error('IDbManagerAdapter.updateCell not implemented')),
  runQuery:    async (type, config, sql) => Promise.reject(new Error('IDbManagerAdapter.runQuery not implemented')),
  insertRow:   async (type, config, table, values) => Promise.reject(new Error('IDbManagerAdapter.insertRow not implemented')),
  runDdl:      async (type, config, sql) => Promise.reject(new Error('IDbManagerAdapter.runDdl not implemented')),
}

// Dev Environment — desktop-only (pwsh runs in the Electron main process). Absence from
// createNoOpAdapters() gates the devenv module to platforms that supply it.
export const IDevenvAdapter = {
  isAvailable: () => false,
  run:     async (config, argv, opts) => Promise.reject(new Error('IDevenvAdapter.run not implemented')),
  answer:  async (runId, answer) => Promise.reject(new Error('IDevenvAdapter.answer not implemented')),
  cancel:  async (runId) => Promise.reject(new Error('IDevenvAdapter.cancel not implemented')),
  catalog: async (config) => Promise.reject(new Error('IDevenvAdapter.catalog not implemented')),
  open:    async (target) => Promise.reject(new Error('IDevenvAdapter.open not implemented')),
  // Runs still alive in the host, as [{ runId, label, exclusive }].
  active:  async () => [],
  // Read-only devenv questions (status) — never queued behind a running command.
  query:   async (config, argv) => ({ code: -1, results: [], stderr: 'not available' }),
  // The devenv profile's files (Profile tab), confined to the profile folder by the host.
  // profileList -> { dir, files: [{ path, size, mtimeMs }], truncated }  (mtimeMs is for display only)
  // profileRead -> { text, bom, stamp } | { missing: true }; stamp is the SHA-256 (hex) of the bytes on disk.
  // profileWrite(config, path, text, { expectedStamp, overwrite, bom, create }) ->
  //   { ok: true, stamp } | { ok: false, conflict: true, stamp } | { ok: false, missing: true }
  profileInfo:   async (config) => Promise.reject(new Error('IDevenvAdapter.profileInfo not implemented')),
  profileList:   async (config) => Promise.reject(new Error('IDevenvAdapter.profileList not implemented')),
  profileRead:   async (config, path) => Promise.reject(new Error('IDevenvAdapter.profileRead not implemented')),
  profileWrite:  async (config, path, text, opts) => Promise.reject(new Error('IDevenvAdapter.profileWrite not implemented')),
  profileCreate: async (config) => Promise.reject(new Error('IDevenvAdapter.profileCreate not implemented')),
  // The file-system path of a File dropped on the window ('' when unknown).
  pathForFile: (file) => '',
  onLine:  (cb) => () => {},
  onExit:  (cb) => () => {},
}

// Desktop-only: runs the git CLI in the Electron main process for the Git Workspace module.
// Deliberately absent from createNoOpAdapters() so the module is gated to platforms that
// supply it. `registered` is the list of registered repo paths; main rejects anything else.
export const IGitAdapter = {
  isAvailable: () => false,
  version:      async () => null,
  resolve:      async (dir) => Promise.reject(new Error('IGitAdapter.resolve not implemented')),
  worktrees:    async (repo, registered) => Promise.reject(new Error('IGitAdapter.worktrees not implemented')),
  // → { porcelain, operation, rebasingBranch, fetchedAt } | { missing: true } | { error }
  status:       async (repo, worktreePath, registered, options) => Promise.reject(new Error('IGitAdapter.status not implemented')), // options.untracked: 'normal' | 'all'; options.countSource: count commits off the source branch even when published
  branches:     async (repo, registered) => Promise.reject(new Error('IGitAdapter.branches not implemented')),
  discover:     async (roots, repos) => [],
  checkFolders: async (paths) => [],
  // Stage 2. change = { area, paths } → { text, truncated, binary, size, gone?, stamp }
  diff:         async (repo, worktreePath, registered, change) => Promise.reject(new Error('IGitAdapter.diff not implemented')),
  // request = { kind: 'files', paths } | { kind: 'commit' } → stamp string for a write's `expected`
  stamp:        async (repo, worktreePath, registered, request) => Promise.reject(new Error('IGitAdapter.stamp not implemented')),
  // Writes → { ok, detail, stale? }. `expected` is the stamp of what the user reviewed.
  stage:           async (repo, worktreePath, registered, paths, expected) => Promise.reject(new Error('IGitAdapter.stage not implemented')),
  unstage:         async (repo, worktreePath, registered, paths, expected) => Promise.reject(new Error('IGitAdapter.unstage not implemented')),
  discard:         async (repo, worktreePath, registered, paths, expected) => Promise.reject(new Error('IGitAdapter.discard not implemented')),
  deleteUntracked: async (repo, worktreePath, registered, paths, expected) => Promise.reject(new Error('IGitAdapter.deleteUntracked not implemented')),
  stageHunk:       async (repo, worktreePath, registered, paths, index, expected) => Promise.reject(new Error('IGitAdapter.stageHunk not implemented')),
  unstageHunk:     async (repo, worktreePath, registered, paths, index, expected) => Promise.reject(new Error('IGitAdapter.unstageHunk not implemented')),
  commit:          async (repo, worktreePath, registered, message, expected) => Promise.reject(new Error('IGitAdapter.commit not implemented')),
  // Stage 3 (read-only). query = { ref, filter, base, search, limit } (historyQuery)
  // → { refs: raw, originHead, shallow }
  refs:          async (repo, worktreePath, registered) => Promise.reject(new Error('IGitAdapter.refs not implemented')),
  // → { text, tip, unpushed: [oid] | null, truncated, limit }
  log:           async (repo, worktreePath, registered, query) => Promise.reject(new Error('IGitAdapter.log not implemented')),
  // → { details: raw } | { missing: true }
  commitDetails: async (repo, worktreePath, registered, oid) => Promise.reject(new Error('IGitAdapter.commitDetails not implemented')),
  // parent: one of the commit's parents, or null for a root commit → { files: raw } | { missing: true }
  commitFiles:   async (repo, worktreePath, registered, oid, parent) => Promise.reject(new Error('IGitAdapter.commitFiles not implemented')),
  // → { text, truncated, binary, size } | { missing: true }
  commitDiff:    async (repo, worktreePath, registered, oid, parent, paths) => Promise.reject(new Error('IGitAdapter.commitDiff not implemented')),
  // Stage 4 (branch and sync actions). kind: one of ACTION_KINDS; options per kind (see actions.js).
  remotes:       async (repo, worktreePath, registered) => Promise.reject(new Error('IGitAdapter.remotes not implemented')),
  stashes:       async (repo, worktreePath, registered) => Promise.reject(new Error('IGitAdapter.stashes not implemented')),
  // → { eligible, reason, details, programs, stamp }
  preview:       async (repo, worktreePath, registered, kind, options) => Promise.reject(new Error('IGitAdapter.preview not implemented')),
  // → { ok, detail, stale?, conflict?, operation? }
  run:           async (repo, worktreePath, registered, kind, options, stamp) => Promise.reject(new Error('IGitAdapter.run not implemented')),
  // File editor. → { files: [rel], truncated }
  files:         async (repo, worktreePath, registered) => Promise.reject(new Error('IGitAdapter.files not implemented')),
  // → { text, bom, stamp } | { missing: true }; rejects for binary or over-1 MB files
  readFile:      async (repo, worktreePath, registered, rel) => Promise.reject(new Error('IGitAdapter.readFile not implemented')),
  // options = { expectedStamp, overwrite, bom } → { ok: true, stamp } | { ok: false, conflict: true, stamp } | { ok: false, missing: true }
  writeFile:     async (repo, worktreePath, registered, rel, text, options) => Promise.reject(new Error('IGitAdapter.writeFile not implemented')),
  // An image as a data URL; side: 'working' | 'index' | 'head'. -> { mime, size, url } | { missing: true }; rejects when over 10 MB or not an image type
  readImage:     async (repo, worktreePath, registered, rel, side) => Promise.reject(new Error('IGitAdapter.readImage not implemented')),
  // Pop-out windows (desktop). spec = { kind: 'editor' | 'conflict' | 'diff', repo, worktree, path, registered, changeId? }.
  openWindow:    async (spec) => Promise.reject(new Error('IGitAdapter.openWindow not implemented')),
  // Tells the other windows a repository was written to; onChanged(cb) hears that and returns its unsubscribe.
  notifyChanged: (repoPath) => {},
  onChanged:     (callback) => () => {},
  // Shows a worktree file (selected) or folder in the OS file manager; rel '' is the worktree root.
  reveal:        async (repo, worktreePath, registered, rel) => Promise.reject(new Error('IGitAdapter.reveal not implemented')),
  // Copies dropped files/folders (absolute source paths) into destDir ('' = the worktree root).
  // options = { dryRun, replace: [rel] }. dryRun -> { total, conflicts: [rel], failed }; otherwise
  // -> { added, replaced, skipped, failed: [{ rel, error }] }. Existing names are replaced only if listed in `replace`.
  importFiles:   async (repo, worktreePath, registered, destDir, sources, options) => Promise.reject(new Error('IGitAdapter.importFiles not implemented')),
  // The file-system path of a File dropped on the window ('' when unknown).
  pathForFile:   (file) => '',
  // Left = git stage 2, right = stage 3. -> { kind, binary, stages: { base, left, right } (each { text, bom } | null), working: { text, bom, stamp } | null, stamp }; rejects when not conflicted
  conflict:      async (repo, worktreePath, registered, rel) => Promise.reject(new Error('IGitAdapter.conflict not implemented')),
  // resolution = { take: 'text', text, bom, force? } | { take: 'left' | 'right' | 'delete' }; expected = conflict().stamp -> { ok: true } | { ok: false, stale: true, detail } | { ok: false, detail }
  resolveConflict: async (repo, worktreePath, registered, rel, resolution, expected) => Promise.reject(new Error('IGitAdapter.resolveConflict not implemented')),
  // Puts the conflict back (git checkout -m); expected = a files stamp
  unresolve:     async (repo, worktreePath, registered, rel, expected) => Promise.reject(new Error('IGitAdapter.unresolve not implemented')),
}
