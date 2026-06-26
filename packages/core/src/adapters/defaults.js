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
