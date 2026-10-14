import React from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment, Annotation, Transaction } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { sql } from '@codemirror/lang-sql'
import { markdown } from '@codemirror/lang-markdown'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'

const LANGUAGES = {
  json: () => json(),
  yaml: () => yaml(),
  sql: () => sql(),
  markdown: () => markdown(),
  powershell: () => StreamLanguage.define(powerShell),
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

export function CodeEditor({ value, language, onChange, ariaLabel }) {
  const host = React.useRef(null)
  const view = React.useRef(null)
  const lang = React.useRef(new Compartment())
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange
  const initial = React.useRef({ value, language, ariaLabel })

  React.useEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: normalize(initial.current.value),
        extensions: [
          basicSetup, THEME, lang.current.of(languageFor(initial.current.language)),
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

  return <div ref={host} style={{ flex: 1, minHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }} />
}
