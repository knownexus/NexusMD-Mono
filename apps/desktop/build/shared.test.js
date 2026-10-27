import { describe, it, expect } from 'vitest'
import { SHARED_SPECIFIERS, sharedName, isSharedImport, importMap, sharedEntrySource, editorKitSpecifiers } from './shared.mjs'

describe('which libraries are shared', () => {
  it('includes React, the workspace libraries and editor-kit\'s code files', () => {
    for (const s of ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@nexusmd/core', '@nexusmd/ui', '@nexusmd/shell-sdk', '@nexusmd/web-adapters', '@nexusmd/editor-kit/code-editor.jsx']) {
      expect(SHARED_SPECIFIERS).toContain(s)
    }
  })
  it('lists each editor-kit script once, without tests or stylesheets', () => {
    const kit = editorKitSpecifiers()
    expect(kit.length).toBeGreaterThan(3)
    expect(kit.some(s => /\.test\./.test(s) || s.endsWith('.css'))).toBe(false)
    expect(new Set(SHARED_SPECIFIERS).size).toBe(SHARED_SPECIFIERS.length)
  })
})

describe('sharedName', () => {
  it('makes a file name from a specifier', () => {
    expect(sharedName('react')).toBe('react')
    expect(sharedName('react/jsx-runtime')).toBe('react_jsx-runtime')
    expect(sharedName('@nexusmd/ui')).toBe('nexusmd_ui')
    expect(sharedName('@nexusmd/editor-kit/code-editor.jsx')).toBe('nexusmd_editor-kit_code-editor')
  })
  it('gives every shared specifier its own name', () => {
    expect(new Set(SHARED_SPECIFIERS.map(sharedName)).size).toBe(SHARED_SPECIFIERS.length)
  })
})

describe('isSharedImport (what an app\'s build leaves alone)', () => {
  it('is true for the shared libraries and editor-kit scripts', () => {
    expect(isSharedImport('react')).toBe(true)
    expect(isSharedImport('react/jsx-runtime')).toBe(true)
    expect(isSharedImport('@nexusmd/ui')).toBe(true)
    expect(isSharedImport('@nexusmd/editor-kit/output-console.jsx')).toBe(true)
  })
  it('is false for an app\'s own files, other packages and stylesheets', () => {
    expect(isSharedImport('./view-git.jsx')).toBe(false)
    expect(isSharedImport('lodash')).toBe(false)
    expect(isSharedImport('@nexusmd/app-git')).toBe(false)
    expect(isSharedImport('@nexusmd/editor-kit/devenv-git.css')).toBe(false)
    expect(isSharedImport('react/jsx-dev-runtime')).toBe(false)
  })
})

describe('importMap', () => {
  it('points every shared specifier at a file under shared/', () => {
    const map = importMap()
    expect(map.imports['react']).toBe('./shared/react.js')
    expect(map.imports['@nexusmd/ui']).toBe('./shared/nexusmd_ui.js')
    expect(Object.keys(map.imports)).toEqual(SHARED_SPECIFIERS)
    expect(Object.values(map.imports).every(v => /^\.\/shared\/[\w-]+\.js$/.test(v))).toBe(true)
  })
})

describe('sharedEntrySource', () => {
  it('re-exports a workspace library whole', () => {
    expect(sharedEntrySource('@nexusmd/ui')).toBe("export * from '@nexusmd/ui'\n")
  })
  it('lists a CommonJS library\'s names so they can be imported by name', () => {
    const src = sharedEntrySource('react', () => ({ useState() {}, Fragment: {}, default: 1, 'not-an-identifier': 1, createElement() {} }))
    expect(src).toContain("import lib from 'react'")
    expect(src).toContain('export default lib')
    expect(src).toContain('export const { Fragment, createElement, useState } = lib')
    expect(src).not.toContain('not-an-identifier')
  })
  it('works for the real React, which has the hooks apps use', () => {
    const src = sharedEntrySource('react')
    for (const name of ['useState', 'useEffect', 'createElement', 'Fragment', 'useSyncExternalStore', 'createContext']) expect(src).toContain(name)
    expect(sharedEntrySource('react/jsx-runtime')).toMatch(/\bjsx\b.*\bjsxs\b|\bjsxs\b.*\bjsx\b/)
    expect(sharedEntrySource('react-dom/client')).toContain('createRoot')
    expect(sharedEntrySource('react-dom')).toContain('createPortal')
  })
})
