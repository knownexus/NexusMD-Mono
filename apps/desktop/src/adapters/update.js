export const updateAdapter = {
  async checkForUpdate() {
    // electron-updater is initialised in main via initUpdater(). No IPC handler
    // for triggering a check is exposed yet — return not-available safely.
    return { available: false };
  },
  async installUpdate() {
    // No-op until Phase 7 wires the full updater IPC
  },
  onUpdateAvailable(_cb) {
    return () => {};
  },
}
