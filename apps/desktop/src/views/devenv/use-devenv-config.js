import React from 'react'
import { getDevenvConfig } from '../../devenv-config.js'

export function useDevenvConfig() {
  const [cfg, setCfg] = React.useState(getDevenvConfig)
  React.useEffect(() => {
    const onChange = () => setCfg(getDevenvConfig())
    window.addEventListener('nexusmd:devenv-config', onChange)
    return () => window.removeEventListener('nexusmd:devenv-config', onChange)
  }, [])
  return cfg
}
