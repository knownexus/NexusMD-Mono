// The libraries every installed app shares with the shell, as ONE copy each. If an app bundled its
// own React, or its own copy of @nexusmd/ui's contexts, hooks and providers would stop working
// across the app/shell boundary. So the shell build exposes each of these as a module of its own
// (shared/<name>.js), an import map in index.html points the bare specifier at it, and each app's
// build leaves these imports alone (see isSharedImport).
import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..')
const require = createRequire(import.meta.url)

// CommonJS libraries need their names listed so they can be re-exported as an ES module.
const COMMONJS = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime']
// ES module libraries of this repo, re-exported whole.
const WORKSPACE = ['@nexusmd/core', '@nexusmd/ui', '@nexusmd/shell-sdk', '@nexusmd/web-adapters']
const EDITOR_KIT = '@nexusmd/editor-kit/'
const SCRIPT = /\.(jsx?|mjs)$/
const TEST = /\.test\./

// editor-kit's code is shared too (CodeMirror must exist once); it is imported file by file.
export function editorKitSpecifiers(dir = join(repo, 'packages', 'editor-kit', 'src')) {
  return readdirSync(dir).filter(f => SCRIPT.test(f) && !TEST.test(f)).sort().map(f => EDITOR_KIT + f)
}

export const SHARED_SPECIFIERS = [...COMMONJS, ...WORKSPACE, ...editorKitSpecifiers()]

// A bare specifier as a file name: "@nexusmd/editor-kit/code-editor.jsx" -> "nexusmd_editor-kit_code-editor"
export function sharedName(specifier) {
  return specifier.replace(/^@/, '').replace(SCRIPT, '').replace(/\//g, '_')
}

// Whether an app's build should leave this import for the page to resolve (through the import map).
// Stylesheets are not modules, so an app bundles the CSS it imports from a shared package.
export function isSharedImport(id) {
  if (SHARED_SPECIFIERS.includes(id)) return true
  return id.startsWith(EDITOR_KIT) && SCRIPT.test(id)
}

export function importMap(prefix = './shared/') {
  return { imports: Object.fromEntries(SHARED_SPECIFIERS.map(s => [s, `${prefix}${sharedName(s)}.js`])) }
}

const IDENT = /^[A-Za-z_$][\w$]*$/

// The source of the entry module that exposes a shared library: the shell builds it (so the shell's
// own imports and the apps' end up as the same instance) and the import map points at the result.
export function sharedEntrySource(specifier, load = id => require(id)) {
  if (COMMONJS.includes(specifier)) {
    const names = Object.keys(load(specifier)).filter(k => IDENT.test(k) && k !== 'default').sort()
    return [
      `import lib from '${specifier}'`,
      'export default lib',
      names.length ? `export const { ${names.join(', ')} } = lib` : '',
      '',
    ].join('\n')
  }
  return `export * from '${specifier}'\n`
}
