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
