import React from 'react'
import { Icon, CardFrame } from '@nexusmd/ui'

export function NotConfigured() {
  return (
    <CardFrame title="Welcome to NexusMD" icon={<Icon name="dashboard" size={16} />}>
      <p style={{ color: 'var(--text-muted)', maxWidth: 520 }}>
        Connect your Azure DevOps organisation in <strong>Settings</strong> to populate your
        dashboard with work items, pull requests, builds and sprint metrics.
      </p>
    </CardFrame>
  )
}
