import React from 'react'
import { Icon, CardFrame } from '@nexusmd/ui'

// What the profile's own service is called; a profile of another type is asked for any of them.
const SERVICE = {
  ado: 'your Azure DevOps organisation',
  jira: 'your Jira site',
  github: 'your GitHub account',
}

export function NotConfigured({ type }) {
  const service = SERVICE[type] || 'Azure DevOps, Jira or GitHub'
  return (
    <CardFrame title="Welcome to NexusMD" icon={<Icon name="dashboard" size={16} />}>
      <p style={{ color: 'var(--text-muted)', maxWidth: 520 }}>
        Connect {service} in <strong>Settings</strong> to populate your
        dashboard with work items, pull requests, builds and sprint metrics.
      </p>
    </CardFrame>
  )
}
