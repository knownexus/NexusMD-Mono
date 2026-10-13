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
  status:       async (repo, worktreePath, registered) => Promise.reject(new Error('IGitAdapter.status not implemented')),
  branches:     async (repo, registered) => Promise.reject(new Error('IGitAdapter.branches not implemented')),
  discover:     async (roots, repos) => [],
  checkFolders: async (paths) => [],
}
