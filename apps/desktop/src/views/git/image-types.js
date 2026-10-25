// The image files the Git Workspace can show instead of "isn't a text file" or "Binary file". Kept in
// step with IMAGE_TYPES in electron/ipc/git-files.cjs, which is what actually reads them.
const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif',
}

/** The MIME type of an image path by its extension, or null for anything else. */
export function imageType(path) {
  const name = String(path ?? '').split(/[\\/]/).pop()
  const dot = name.lastIndexOf('.')
  // A leading dot is a hidden file's name, not an extension (as path.extname in main reads it).
  return dot > 0 ? TYPES[name.slice(dot + 1).toLowerCase()] ?? null : null
}

export const isImagePath = path => imageType(path) !== null
