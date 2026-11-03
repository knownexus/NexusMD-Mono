import { useEffect, useState } from 'react'

const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x))

/**
 * The subset of `paths` that does not exist on this computer, as a Set. Checked on mount, whenever
 * the list changes and on window focus, so a folder that appears later enables again. Where the
 * host cannot check (Android, web: no electronAPI.file.exists) or a check throws, a path counts as
 * present.
 */
export function usePathsMissing(paths) {
  const [missing, setMissing] = useState(() => new Set())
  const key = JSON.stringify(paths)
  useEffect(() => {
    let alive = true
    const list = JSON.parse(key)
    const check = async () => {
      const exists = window.electronAPI?.file?.exists
      if (typeof exists !== 'function') { if (alive) setMissing(prev => (prev.size ? new Set() : prev)); return }
      const found = await Promise.all(list.map(async p => {
        try { return (await window.electronAPI.file.exists(p)) !== false } catch { return true }
      }))
      if (!alive) return
      const next = new Set(list.filter((_, i) => !found[i]))
      setMissing(prev => (sameSet(prev, next) ? prev : next))
    }
    check()
    window.addEventListener('focus', check)
    return () => { alive = false; window.removeEventListener('focus', check) }
  }, [key])
  return missing
}

export const notOnThisComputer = path => `Not on this computer: ${path}`
