// NOTE: Replace with @capacitor/filesystem adapter once that package is added.
// Profile storage is currently localStorage-based (profile-context.jsx); this
// no-op prevents initCore from crashing while file-based profiles are deferred.
export const fileAdapter = {
  async read(_path)          { throw new Error('fileAdapter: not implemented') },
  async write(_path, _text)  {},
  async exists(_path)        { return false },
  async list(_dir)           { return [] },
  async delete(_path)        {},
  async mkdir(_dir)          {},
  async defaultProfileDir()  { return 'profiles' },
}
