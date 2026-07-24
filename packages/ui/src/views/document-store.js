// document-store.js — shared multi-document save/load system: autosave a
// working buffer into a named document, mirroring MarkdownViewer's model
// (see MarkdownViewer.jsx's loadDocs/saveDocs/generateId/relativeTime and
// its autosave effect), generalized to work with any content shape (a
// string, or a structured object) rather than assuming markdown text.
import React from 'react'
import { usePersisted } from '../app-components.jsx'

const { useState, useEffect, useRef } = React

export function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export function displayName(doc) {
  return doc.name ?? doc.autoName
}

export function relativeTime(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

// Reproduces MarkdownViewer's autosave state machine: a 300ms debounce to
// update the currently-open document, and a 1500ms debounce to silently
// create a new one once typing starts with nothing open. `isEmpty(content)`
// and `extractAutoName(content)` let each caller define what "nothing to
// save yet" and "a display name" mean for their content shape.
export function useDocumentAutosave({ storageKey, initialContent, emptyContent, isEmpty, extractAutoName }) {
  const [docs, setDocs] = usePersisted(storageKey, [])
  const [content, setContent] = useState(initialContent)
  const [currentDocId, setCurrentDocId] = useState(null)
  const [saveStatus, setSaveStatus] = useState('')

  // Kept fresh every render so the debounced timer callbacks below always
  // read the latest typed content, not a stale closure from when the timer
  // was scheduled.
  const contentRef = useRef(content)
  contentRef.current = content

  const isLoadingDoc = useRef(false)
  const saveTimerRef = useRef(null)
  const createDocTimerRef = useRef(null)
  const saveStatusTimerRef = useRef(null)

  useEffect(() => {
    // Skip when we programmatically loaded/reset content (open/new/delete),
    // not a user edit.
    if (isLoadingDoc.current) { isLoadingDoc.current = false; return }

    clearTimeout(saveTimerRef.current)
    clearTimeout(createDocTimerRef.current)

    if (isEmpty(content)) { setSaveStatus(''); return }

    if (currentDocId) {
      setSaveStatus('saving')
      saveTimerRef.current = setTimeout(() => {
        const c = contentRef.current
        setDocs(prev => prev.map(d => d.id === currentDocId
          ? { ...d, content: c, autoName: extractAutoName(c), updatedAt: Date.now() }
          : d
        ))
        setSaveStatus('saved')
        clearTimeout(saveStatusTimerRef.current)
        saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000)
      }, 300)
    } else {
      setSaveStatus('unsaved')
      createDocTimerRef.current = setTimeout(() => {
        const c = contentRef.current
        if (isEmpty(c)) return
        const newDocEntry = {
          id: generateId(), name: null,
          autoName: extractAutoName(c), content: c,
          createdAt: Date.now(), updatedAt: Date.now(),
        }
        setCurrentDocId(newDocEntry.id)
        setDocs(prev => [...prev, newDocEntry])
        setSaveStatus('saved')
        clearTimeout(saveStatusTimerRef.current)
        saveStatusTimerRef.current = setTimeout(() => setSaveStatus(''), 2000)
      }, 1500)
    }

    return () => {
      clearTimeout(saveTimerRef.current)
      clearTimeout(createDocTimerRef.current)
    }
  }, [content, currentDocId])

  useEffect(() => () => clearTimeout(saveStatusTimerRef.current), [])

  function openDoc(id) {
    clearTimeout(saveTimerRef.current)
    clearTimeout(createDocTimerRef.current)
    const doc = docs.find(d => d.id === id)
    if (!doc) return
    isLoadingDoc.current = true
    setContent(doc.content)
    setCurrentDocId(id)
    setSaveStatus('')
  }

  function newDoc() {
    clearTimeout(saveTimerRef.current)
    clearTimeout(createDocTimerRef.current)
    isLoadingDoc.current = true
    setCurrentDocId(null)
    setContent(emptyContent)
    setSaveStatus('')
  }

  function deleteDoc(id) {
    setDocs(prev => prev.filter(d => d.id !== id))
    if (currentDocId === id) {
      isLoadingDoc.current = true
      setCurrentDocId(null)
      setContent(emptyContent)
      setSaveStatus('')
    }
  }

  function renameDoc(id, name) {
    setDocs(prev => prev.map(d => d.id === id ? { ...d, name: name || null } : d))
  }

  const hasUnsavedContent = !currentDocId && !isEmpty(content)

  return { content, setContent, docs, currentDocId, saveStatus, hasUnsavedContent, openDoc, newDoc, deleteDoc, renameDoc }
}
