// The devenv run lives here, above the view switch, so leaving the Dev Environment screen
// (or the screen remounting) never detaches a run that may still need an answer. Its
// prompts are shown from here too, whichever screen is open.
import React from 'react'
import { useDevenvRun } from './use-devenv-run.js'
import { useDevenvConfig } from './use-devenv-config.js'
import { PromptHost } from './prompt-host.jsx'

const DevenvRunContext = React.createContext(null)

export function useDevenvRunContext() {
  return React.useContext(DevenvRunContext)
}

function useLeftoverRuns(adapter) {
  const [runs, setRuns] = React.useState([])
  const [error, setError] = React.useState(null)

  // Only runs found at mount count: they were started by a window that has since reloaded.
  React.useEffect(() => {
    let live = true
    Promise.resolve(adapter.active?.())
      .then(list => { if (live && Array.isArray(list)) setRuns(list) })
      .catch(() => {})
    return () => { live = false }
  }, [adapter])

  React.useEffect(() => adapter.onExit(msg => setRuns(rs => rs.filter(r => r.runId !== msg.runId))), [adapter])

  const cancelAll = React.useCallback(async () => {
    setError(null)
    const ids = runs.map(r => r.runId)
    for (const id of ids) {
      try { await adapter.cancel(id) } catch (e) { setError(e?.message || 'Cancel failed') }
    }
    try {
      const alive = await adapter.active()
      setRuns(rs => rs.filter(r => (alive || []).some(a => a.runId === r.runId)))
    } catch { /* the exit events still clear the list */ }
  }, [adapter, runs])

  return { runs, error, cancelAll }
}

function Provider({ adapter, notify, children }) {
  const config = useDevenvConfig()
  const run = useDevenvRun({ adapter, config, notify })
  const leftover = useLeftoverRuns(adapter)
  const prompt = run.state.prompts[0]
  const leftoverRuns = leftover.runs.filter(r => r.runId !== run.state.runId)

  const value = { ...run, config, leftover: { ...leftover, runs: leftoverRuns } }

  return (
    <DevenvRunContext.Provider value={value}>
      {children}
      {prompt && (
        <PromptHost key={prompt.id} prompt={prompt}
          onAnswer={v => run.answer(prompt.id, v)}
          onCancel={() => run.cancelPrompt(prompt.id)} />
      )}
    </DevenvRunContext.Provider>
  )
}

export function DevenvRunProvider({ adapter, notify, children }) {
  if (!adapter?.isAvailable?.()) return children
  return <Provider adapter={adapter} notify={notify}>{children}</Provider>
}
