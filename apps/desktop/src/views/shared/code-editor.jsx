import React from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment, Annotation, Transaction } from '@codemirror/state'
import { Decoration } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { languageExtension, languageForPath } from './languages.js'

export { languageForPath }

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

// `lineClasses` as line decorations: [[1-based line, className], …]; lines past the end are ignored.
const lineDecorations = (doc, list) => {
  const marks = (list ?? []).filter(([n]) => n >= 1 && n <= doc.lines).sort((a, b) => a[0] - b[0])
    .map(([n, cls]) => Decoration.line({ class: cls }).range(doc.line(n).from))
  return EditorView.decorations.of(Decoration.set(marks))
}

/**
 * `lineClasses` tints whole lines ([[line, className], …]); they apply to the document as it is
 * after `value`, so pass classes worked out from that same text.
 */
export function CodeEditor({ value, language, onChange, ariaLabel, line = null, readOnly = false, lineClasses = null }) {
  const host = React.useRef(null)
  const view = React.useRef(null)
  const lang = React.useRef(new Compartment())
  const ro = React.useRef(new Compartment())
  const tints = React.useRef(new Compartment())
  const replaced = React.useRef(false)
  const jumped = React.useRef(null)
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange
  const initial = React.useRef({ value, language, ariaLabel, readOnly })

  React.useEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: normalize(initial.current.value),
        extensions: [
          basicSetup, THEME, syntaxHighlighting(classHighlighter), lang.current.of(languageExtension(initial.current.language)),
          ro.current.of(EditorState.readOnly.of(!!initial.current.readOnly)),
          tints.current.of([]),
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
    if (v && v.state.doc.toString() !== next) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next }, annotations: [External.of(true), Transaction.addToHistory.of(false)] })
      replaced.current = true
    }
  }, [value])

  React.useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(languageExtension(language)) })
  }, [language])

  // After the value effect, so the classes land on the text they were worked out from.
  React.useEffect(() => {
    const v = view.current
    v?.dispatch({ effects: tints.current.reconfigure(lineClasses?.length ? lineDecorations(v.state.doc, lineClasses) : []) })
  }, [lineClasses, value])

  React.useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(!!readOnly)) })
  }, [readOnly])

  // `line` is a 1-based number, or a { line } object: a new object always jumps, even to the same line.
  // Declared after the value effect so replaced text is in place first; typing alone never re-jumps.
  React.useEffect(() => {
    const v = view.current
    const wanted = typeof line === 'object' && line ? line.line : line
    const changed = jumped.current !== line
    const wasReplaced = replaced.current
    jumped.current = line
    replaced.current = false
    if (!v || !(changed || wasReplaced) || typeof wanted !== 'number' || !Number.isFinite(wanted)) return
    const pos = v.state.doc.line(Math.min(Math.max(1, Math.floor(wanted)), v.state.doc.lines)).from
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  }, [line, value])

  return <div ref={host} style={{ flex: 1, minHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }} />
}
