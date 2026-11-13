// home-widgets.jsx — the mobile wrapper around the shared Home widgets (@nexusmd/ui). The host, sheet and widget
// bodies are shared; this file builds their `ctx` from what the mobile app holds (HelmData, the profile's lists
// and time log in localStorage, the repo list, the artifacts sheet and bug flow) and passes it in.
import React from 'react';
import {
  WidgetHost as SharedWidgetHost, WidgetSheet as SharedWidgetSheet, WIDGET_TYPES, Sheet,
} from '@nexusmd/ui';
import { readLists } from '@nexusmd/core';
import { HelmData } from '../data.jsx';
import { getProfileKey } from '../profile-keys.js';
import { listRepoChoices } from '../git-view.jsx';
import { mobileTimerStore, createBug, BuildArtifactsSheet } from './dashboard-interactive-widgets.jsx';
import { openTarget, resolveTarget } from '../shortcut-host.js';
import { targetSources } from '../shortcut-sources.js';

export { WIDGET_TYPES };

const listsStore = () => ({ storage: localStorage, getProfileKey, namespace: 'helm' });

/** What the widgets read, from the mobile app's globals and storage; the dashboard's own ctx wins. */
export function mobileWidgetCtx(ctx = {}, timer = mobileTimerStore(getProfileKey('nexusmd.timelog.v1'))) {
  return {
    prs: HelmData?.PRS || [],
    builds: HelmData?.BUILDS || [],
    tests: HelmData?.TESTS || [],
    workItems: HelmData?.WORK_ITEMS || [],
    me: HelmData?.ME?.id,
    lists: readLists(listsStore()).lists,
    timer,
    onCreateBug: createBug,
    ArtifactsSheet: BuildArtifactsSheet,
    openTarget,
    resolveTarget,
    ...ctx,
    team: ctx.team?.length ? ctx.team : HelmData?.TEAM || [],
  };
}

export function WidgetHost({ ctx, ...props }) {
  const timeKey = getProfileKey('nexusmd.timelog.v1');
  const timer = React.useMemo(() => mobileTimerStore(timeKey), [timeKey]);
  return <SharedWidgetHost {...props} ctx={mobileWidgetCtx(ctx, timer)}/>;
}

export function WidgetSheet(props) {
  return <SharedWidgetSheet Sheet={Sheet} listRepoChoices={listRepoChoices} targetSources={targetSources} {...props}/>;
}
