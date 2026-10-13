// One devenv run, from start to exit, as React state. Events can arrive before run()
// resolves with the runId, so everything is buffered by runId until it is known.
import React from 'react'
import {
  createRunState, applyStarting, applyStarted, applyStartFailed, applyLine,
  applyAnswered, applyOpened, applyCancelRequested, applyExit, parseDevenvLine,
} from '@nexusmd/core'

export function useDevenvRun({ adapter, config, notify }) {
  const [state, setState] = React.useState(() => createRunState())
  // -1 = no run yet. Only null (a start in flight) buffers events: other screens' runs (a log
  // follow) stream all the time, and buffering them while idle would grow without bound.
  const runIdRef = React.useRef(-1)
  const pendingRef = React.useRef([])
  const cancelPendingRef = React.useRef(false)
  const notifyRef = React.useRef(notify)
  notifyRef.current = notify

  const handleLine = React.useCallback(msg => {
    if (msg.stream === 'stdout') {
      const parsed = parseDevenvLine(msg.line)
      if (parsed.type === 'prompt' && typeof document !== 'undefined' && !document.hasFocus()) {
        notifyRef.current?.('devenv needs an answer', parsed.title || parsed.prompt || '')
      }
    }
    setState(s => applyLine(s, msg.stream, msg.line))
  }, [])

  React.useEffect(() => {
    const offLine = adapter.onLine(msg => {
      if (runIdRef.current === null) { pendingRef.current.push({ kind: 'line', msg }); return }
      if (msg.runId === runIdRef.current) handleLine(msg)
    })
    const offExit = adapter.onExit(msg => {
      if (runIdRef.current === null) { pendingRef.current.push({ kind: 'exit', msg }); return }
      if (msg.runId === runIdRef.current) setState(s => applyExit(s, msg.code))
    })
    return () => { offLine(); offExit() }
  }, [adapter, handleLine])

  React.useEffect(() => {
    if (!state.opens.length) return
    for (const o of state.opens) {
      adapter.open(o.url ? { url: o.url } : { path: o.path })
        .catch(e => setState(s => ({ ...s, error: `Couldn't open ${o.url || o.path}: ${e?.message || 'failed'}` })))
    }
    setState(s => applyOpened(s))
  }, [state.opens, adapter])

  // Starting a new run replaces this hook's view, so callers start one only once the
  // previous run has ended (the Commands screen disables Run while one is active).
  const start = React.useCallback(async (argv, { exclusive, label }) => {
    runIdRef.current = null
    cancelPendingRef.current = false
    pendingRef.current = []
    setState(s => applyStarting({ ...s, command: label }))
    try {
      const { runId } = await adapter.run(config, argv, { exclusive, label })
      runIdRef.current = runId
      setState(s => applyStarted(s, runId))
      if (cancelPendingRef.current) {
        cancelPendingRef.current = false
        adapter.cancel(runId).catch(e => setState(s => ({ ...s, cancelling: false, error: e.message })))
      }
      const pending = pendingRef.current
      pendingRef.current = []
      for (const p of pending) {
        if (p.msg.runId !== runId) continue
        if (p.kind === 'line') handleLine(p.msg)
        else setState(s => applyExit(s, p.msg.code))
      }
    } catch (e) {
      runIdRef.current = -1
      setState(s => applyStartFailed(s, e.message))
    }
  }, [adapter, config, handleLine])

  // Errors never include the answer value (it may be a password).
  const fail = e => setState(s => ({ ...s, error: e?.message || 'Request failed' }))

  const answer = React.useCallback(async (promptId, value) => {
    setState(s => applyAnswered(s, promptId))
    try { await adapter.answer(runIdRef.current, { id: promptId, value }) } catch (e) { fail(e) }
  }, [adapter])

  // devenv stops itself after a cancelled prompt ("Cancelled.", exit 1); marking the run as
  // cancelling makes that exit read as Cancelled rather than Failed.
  const cancelPrompt = React.useCallback(async promptId => {
    setState(s => applyCancelRequested(applyAnswered(s, promptId)))
    try { await adapter.answer(runIdRef.current, { id: promptId, cancel: true }) } catch (e) {
      setState(s => ({ ...s, cancelling: false, error: e?.message || 'Request failed' }))
    }
  }, [adapter])

  const cancel = React.useCallback(async () => {
    setState(s => applyCancelRequested(s))
    if (runIdRef.current === -1) { setState(s => ({ ...s, cancelling: false })); return }
    if (runIdRef.current === null) { cancelPendingRef.current = true; return }
    try { await adapter.cancel(runIdRef.current) } catch (e) { setState(s => ({ ...s, cancelling: false, error: e?.message || 'Cancel failed' })) }
  }, [adapter])

  return { state, start, answer, cancelPrompt, cancel }
}
