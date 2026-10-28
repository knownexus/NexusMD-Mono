import React from 'react'
import { displayIdOf } from '@nexusmd/core'
import {
  Icon, useNexusData, toast, WorkItemDetail, BuildDetail, Drawer, TypeIcon, Prio, WorkItemFieldsEditor, PRTabs,
} from '@nexusmd/ui'
import { linkAdapter } from '@nexusmd/shell-sdk'
import { createAdoHttpAdapter, getAdoConfig } from './ado-client.js'
import { PersonSummary, PersonActions } from './person-summary.jsx'

// The side drawer for a work item, pull request, person or build.
export function DetailDrawer({ drawer, onClose, setItems, onOpenItem, onOpenPR }) {
  const open = drawer != null
  const kind = drawer?.kind
  const d    = drawer?.data
  const http = React.useMemo(() => createAdoHttpAdapter(), [])
  const { workItemSource } = useNexusData()

  const title = !d ? '' : kind === 'wi' ? d.title : kind === 'pr' ? d.title : kind === 'person' ? d.name : kind === 'build' ? d.pipeline : ''

  const { org } = getAdoConfig()
  const adoUrl = kind === 'wi' ? workItemSource.webUrl(d)
    : kind === 'pr' ? d?.url
    : kind === 'build' && (d?.projectName || d?.project) && org
      ? `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(d.projectName || d.project)}/_build/results?buildId=${d.id}`
      : null

  const markDone = async () => {
    try {
      const r = await workItemSource.moveToCategory(d.id, 'Completed', d)
      setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, state: r.state, stateCategory: r.stateCategory } : w))
      toast?.('Marked done', 'success')
      onClose()
    } catch (e) {
      toast?.('Could not update: ' + (e?.message || 'unknown error'), 'error')
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={title}
      badges={kind === 'wi' && d ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{displayIdOf(d)}</span>
          <TypeIcon type={d.type}/><Prio p={d.priority}/>
        </span>
      ) : kind === 'pr' && d ? (
        <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
      ) : kind === 'build' && d ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>#{d.id}</span>
          <span className={`build-dot ${d.status}`}/>
        </span>
      ) : null}
      actions={(
        <React.Fragment>
          {kind === 'wi' && d && (
            <button className="btn sm" onClick={markDone}>
              <Icon name="check" size={13}/> Mark done
            </button>
          )}
          {kind === 'person' && d && <PersonActions dev={d} />}
          {adoUrl && (
            <button className="btn sm ghost" onClick={() => linkAdapter.openLink(adoUrl)}>
              <Icon name="link" size={12}/> Open in {kind === 'wi' ? (d?.source === 'jira' ? 'Jira' : d?.source === 'github' ? 'GitHub' : 'ADO') : kind === 'build' ? 'ADO' : 'browser'}
            </button>
          )}
        </React.Fragment>
      )}>
      {kind === 'wi' && d && (
        <React.Fragment>
          <WorkItemFieldsEditor item={d} onItemUpdated={patch => setItems?.(arr => arr.map(w => w.id === d.id ? { ...w, ...patch } : w))} />
          <WorkItemDetail id={d.id} project={d.project} />
        </React.Fragment>
      )}
      {kind === 'pr' && d && <PRTabs key={d.id} pr={d} http={http} />}
      {kind === 'person' && d && <PersonSummary dev={d} onOpenItem={onOpenItem} onOpenPR={onOpenPR} />}
      {kind === 'build' && d && <BuildDetail build={d} />}
    </Drawer>
  )
}
