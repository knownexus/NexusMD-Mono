// An app manifest is static JSON-shaped data describing one installable app. The
// installer, the main process and the renderer all read it, so it carries no code.
//   id           stable app id (also the folder name under modules/)
//   label        name shown in the combined shell and the installer checklist
//   productName  window/shortcut name when it is the only app installed
//   nav          sidebar entries this app contributes: [{ id, label, icon, order? }]; each id is a view id
//   order        position among the apps (lower first)
const ID = /^[a-z][a-z0-9-]*$/

export function validateManifest(m) {
  const errors = []
  if (!m || typeof m !== 'object') return ['manifest must be an object']
  if (typeof m.id !== 'string' || !ID.test(m.id)) errors.push('id must be lowercase letters, digits and dashes')
  if (typeof m.label !== 'string' || !m.label) errors.push('label is required')
  if (typeof m.productName !== 'string' || !m.productName) errors.push('productName is required')
  if (!Array.isArray(m.nav)) errors.push('nav must be an array')
  else {
    for (const n of m.nav) {
      if (!n || typeof n.id !== 'string' || typeof n.label !== 'string' || typeof n.icon !== 'string') {
        errors.push('every nav entry needs id, label and icon')
        break
      }
    }
  }
  if (m.order != null && typeof m.order !== 'number') errors.push('order must be a number')
  return errors
}
