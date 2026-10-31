import React from 'react'
import { getProfileKey } from '@nexusmd/shell-sdk'
import { TimeView } from '@nexusmd/ui'

// The desktop shell's Time screen: the shared view, kept per profile, offering the tickets the Work app
// provides through the `work.items` capability (none when Work isn't installed).
export function TimeApp({ host }) {
  const getTickets = React.useCallback(() => {
    const caps = host?.capabilities
    return caps?.has('work.items') ? caps.call('work.items') : []
  }, [host])
  return <TimeView storageKey={getProfileKey('nexusmd.timelog.v1')} getTickets={getTickets}/>
}
