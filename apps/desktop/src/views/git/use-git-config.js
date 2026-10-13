import React from 'react'
import { getGitConfig, GIT_CONFIG_EVENT } from '../../git-config.js'

export function useGitConfig() {
  const [cfg, setCfg] = React.useState(getGitConfig)
  React.useEffect(() => {
    const onChange = () => setCfg(getGitConfig())
    window.addEventListener(GIT_CONFIG_EVENT, onChange)
    return () => window.removeEventListener(GIT_CONFIG_EVENT, onChange)
  }, [])
  return cfg
}
