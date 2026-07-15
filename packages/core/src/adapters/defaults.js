import {
  IFileAdapter, IHttpAdapter, IStorageAdapter,
  INotificationAdapter, IPickerAdapter, IAuthAdapter, IClipboardAdapter,
  ISecureStorageAdapter, INetworkAdapter, ILifecycleAdapter, IShareAdapter,
  ITrayAdapter, INavigationAdapter, IThemeAdapter, IUpdateAdapter,
  IBadgeAdapter, IDeepLinkAdapter,
} from './index.js'

// Returns shallow copies of every interface shape.
// Apps spread one or more of these and override only the methods they support:
//   const myAdapters = {
//     ...createNoOpAdapters(),
//     file: myFileAdapter,
//     storage: myStorageAdapter,
//   }
//
// IScriptRunnerAdapter/IRawHttpAdapter are deliberately NOT included here: the
// api-client module's requiredAdapters gate (packages/core/src/features/module-registry.js
// hasRequiredAdapters) only works if a platform that doesn't implement scriptRunner
// truly has no `scriptRunner` key on its adapters object. Every app spreads
// createNoOpAdapters() as the base of its adapters object, so giving these two a
// no-op entry here would make them "present" (if rejecting) everywhere, defeating
// the desktop-only gating. Desktop adds real implementations explicitly instead.
export function createNoOpAdapters() {
  return {
    file:          { ...IFileAdapter },
    http:          { ...IHttpAdapter },
    storage:       { ...IStorageAdapter },
    notification:  { ...INotificationAdapter },
    picker:        { ...IPickerAdapter },
    auth:          { ...IAuthAdapter },
    clipboard:     { ...IClipboardAdapter },
    secureStorage: { ...ISecureStorageAdapter },
    network:       { ...INetworkAdapter },
    lifecycle:     { ...ILifecycleAdapter },
    share:         { ...IShareAdapter },
    tray:          { ...ITrayAdapter },
    navigation:    { ...INavigationAdapter },
    theme:         { ...IThemeAdapter },
    update:        { ...IUpdateAdapter },
    badge:         { ...IBadgeAdapter },
    deepLink:      { ...IDeepLinkAdapter },
  }
}
