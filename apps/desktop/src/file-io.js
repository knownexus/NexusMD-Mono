// Desktop (Electron) file I/O for profile bundles. Built on the existing
// pickerAdapter, which bridges to native open/save dialogs over IPC
// (electron/ipc/picker.js).
import { pickerAdapter } from './adapters/picker.js'

export const desktopFileIO = {
  /** Resolves true once saved, false when the save dialog was cancelled. */
  async saveFile(filename, text) {
    return (await pickerAdapter.saveFile(filename, text)) !== false
  },
  async pickFile() {
    const picked = await pickerAdapter.pickFile({ ext: '.nmdprofile,.nmdplanner' })
    return picked?.text ?? null
  },
}
