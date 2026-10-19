import React from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment, Annotation, Transaction } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { csharp } from '@codemirror/legacy-modes/mode/clike'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'

const LANGUAGES = {
  json: () => json(),
  yaml: () => yaml(),
  sql: () => sql(),
  markdown: () => markdown(),
  powershell: () => StreamLanguage.define(powerShell),
  javascript: () => javascript({ jsx: true }),
  typescript: () => javascript({ jsx: true, typescript: true }),
  css: () => css(),
  html: () => html(),
  csharp: () => StreamLanguage.define(csharp),
}
const EXTENSIONS = {
  javascript: ['js', 'mjs', 'cjs', 'jsx'], typescript: ['ts', 'tsx', 'mts', 'cts'], css: ['css', 'scss', 'less'],
  html: ['html', 'htm'], csharp: ['cs', 'csx'], json: ['json'], yaml: ['yml', 'yaml'], sql: ['sql'],
  markdown: ['md', 'markdown'], powershell: ['ps1', 'psm1', 'psd1'],
}
const BY_EXTENSION = new Map(Object.entries(EXTENSIONS).flatMap(([name, exts]) => exts.map(e => [e, name])))
// Highlighting language for a file path, or null for plain text.
export function languageForPath(path) {
  const base = String(path ?? '').split(/[\\/]/).pop()
  const dot = base.lastIndexOf('.')
  return dot < 0 ? null : BY_EXTENSION.get(base.slice(dot + 1).toLowerCase()) ?? null
}
const languageFor = name => LANGUAGES[name]?.() ?? []

// Marks transactions that replace the document from props, so they are not echoed to onChange.
const External = Annotation.define()
// CodeMirror stores documents with LF only, so compare and insert in that form.
const normalize = text => (text ?? '').replace(/\r\n?/g, '\n')

// NexusMD's own colours and monospace stack, so the editor reads like the rest of the app.
const THEME = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--surface-2)', fontSize: '12px', height: '100%' },
  '.cm-content': { fontFamily: "'Cascadia Code', 'Fira Code', Consolas, Menlo, monospace", caretColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--text-muted)', borderRight: '1px solid var(--border)' },
  '&.cm-focused': { outline: '1px solid var(--accent-border, var(--border))' },
})

export function CodeEditor({ value, language, onChange, ariaLabel, line = null, readOnly = false }) {
  const host = React.useRef(null)
  const view = React.useRef(null)
  const lang = React.useRef(new Compartment())
  const ro = React.useRef(new Compartment())
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange
  const initial = React.useRef({ value, language, ariaLabel, readOnly })

  React.useEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: normalize(initial.current.value),
        extensions: [
          basicSetup, THEME, lang.current.of(languageFor(initial.current.language)),
          ro.current.of(EditorState.readOnly.of(!!initial.current.readOnly)),
          EditorView.contentAttributes.of({ 'aria-label': initial.current.ariaLabel }),
          EditorView.updateListener.of(u => {
            // Only user edits report back; documents replaced from outside are already known.
            if (u.docChanged && !u.transactions.some(t => t.annotation(External))) onChangeRef.current?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = v
    return () => { v.destroy(); view.current = null }
  }, [])

  React.useEffect(() => {
    const v = view.current
    const next = normalize(value)
    // Kept out of undo history: undoing a Revert/Reload would resurrect discarded text and report it as a user edit.
    if (v && v.state.doc.toString() !== next) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next }, annotations: [External.of(true), Transaction.addToHistory.of(false)] })
  }, [value])

  React.useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(languageFor(language)) })
  }, [language])

  React.useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)) })
  }, [readOnly])

  // Declared after the value effect so a new file's text is in place before its line is selected.
  React.useEffect(() => {
    const v = view.current
    if (!v || typeof line !== 'number') return
    const pos = v.state.doc.line(Math.min(Math.max(1, Math.floor(line)), v.state.doc.lines)).from
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  }, [line])

  return <div ref={host} style={{ flex: 1, minHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }} />
}
