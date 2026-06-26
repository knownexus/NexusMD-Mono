// @nexusmd/web-adapters — browser implementations of the @nexusmd/core adapter
// interfaces that were byte-for-byte identical across web, desktop, and app.
//
// Platform-specific adapters (file, picker, secureStorage, auth, badge, deepLink,
// tray, navigation, http, update) stay in each app; only the universal browser
// ones live here.

export { localStorageAdapter } from './storage.js'
export { clipboardAdapter } from './clipboard.js'
export { lifecycleAdapter } from './lifecycle.js'
export { networkAdapter } from './network.js'
export { notificationAdapter } from './notification.js'
export { shareAdapter } from './share.js'
export { themeAdapter } from './theme.js'
