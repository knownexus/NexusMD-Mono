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
