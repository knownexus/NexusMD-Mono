// dashboard-interactive-widgets.jsx — the mobile glue for the Home widgets you can act on. The widgets themselves
// are shared (@nexusmd/ui); this file supplies what only the mobile app has: localStorage keys scoped to the
// profile, the Android artifacts sheet and the `helm:create-wi` bug flow.
import React from 'react';
import {
  WidgetCard, TimeWidget as SharedTimeWidget, NotesWidget, LatestBuild, LatestTest, storageTimerStore,
} from '@nexusmd/ui';
import { HelmData } from '../data.jsx';
import { getProfileKey } from '../profile-keys.js';
import { BuildArtifactsSheet } from './build-artifacts-sheet.jsx';

export { WidgetCard as Card, NotesWidget, LatestBuild, LatestTest, BuildArtifactsSheet };

/** The timer store for a time-log key: the log at `storageKey`, paused timers at the profile's helm.dash.timePaused. */
export const mobileTimerStore = (storageKey) =>
  storageTimerStore({ storage: localStorage, logKey: storageKey, pausedKey: getProfileKey('helm.dash.timePaused') });

export function TimeWidget({ storageKey, navTo }) {
  const timer = React.useMemo(() => mobileTimerStore(storageKey), [storageKey]);
  return <SharedTimeWidget timer={timer} navTo={navTo}/>;
}

/** Opens the New work item sheet as a Bug, in the first configured project. */
export const createBug = (detail) => window.dispatchEvent(new CustomEvent('helm:create-wi', {
  detail: { type: 'Bug', project: (HelmData.CONFIG_PROJECTS || [])[0] || '', ...detail },
}));
