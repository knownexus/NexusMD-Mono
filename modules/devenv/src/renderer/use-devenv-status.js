import { normaliseStatus } from '@nexusmd/core'
import { useDevenvQuery } from './use-devenv-query.js'

const ARGV = ['status', '--json']

// Status keeps refreshing while start/stop run (devenv:query never waits for the exclusive slot).
export function useDevenvStatus({ adapter, config, runStatus, intervalMs = 10000 }) {
  const { data, ...rest } = useDevenvQuery({ adapter, config, argv: ARGV, kind: 'status', normalise: normaliseStatus, runStatus, intervalMs })
  return { status: data, ...rest }
}
