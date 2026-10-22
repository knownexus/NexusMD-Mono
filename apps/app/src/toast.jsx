// toast.jsx — the shared toast bus + host from @nexusmd/ui, re-exported so existing
// app import paths keep working. Sharing one bus lets toasts raised inside shared
// views (e.g. WorkItemDetail) reach this app's ToastHost.
export { toast, ToastHost, NexusMDToastBus } from '@nexusmd/ui';
