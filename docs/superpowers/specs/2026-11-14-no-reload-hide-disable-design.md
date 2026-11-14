# Hiding, disabling and syncing without reloading the app

Turning an app or a page off, or receiving a change from another computer, no longer restarts or reloads the window unless it has to.

## What reloaded, and why

- **Settings › Desktop › Apps** saved your choice and then asked for "Restart now": each app's background side and its bridge to the page are set
  up once at launch. (Work screens, sidebar hiding, dashboard parts and the theme were already live.)
- **AccountGate** reloaded the window after *any* pull that changed local data, so a page hidden on another computer reloaded this one, and so
  did loading a profile you were not even using.

## Apps card

An app that was running at launch is only hidden or shown again: its code is loaded, so showing it is just not hiding it. `shell/apps-disabled.js`
holds which apps are switched off (kept in session storage so a reload keeps it, and seeded from the saved list in the main process when the shell
starts). `useModuleOffViews` adds every sidebar entry of a switched-off app to the off views, so the sidebar entry goes, the open screen is left for
another, and the app's Settings panels, cards and banner go with it. The one case that still needs a restart is turning on an app that was already
off when NexusMD started, because its code was never loaded; the card says so only then ("Restart to turn on"). A switched-off app's background part
keeps running until the next start. Importing a settings file uses the same path.

## Changes from another computer

`onApplied` now reports what was written: `{ applied, items: [{ id, profileId }], global }`. `appliedAction` (packages/ui/src/applied-policy.js) decides:

- **none** when only profiles that are not in use changed (nothing on screen shows them; switching profile reloads anyway);
- **live** when only settings of the profile in use changed that the open screens can read again (a profile's tweaks, the Work screens switched off, the
  collapsed Settings sections: `isLiveSafe` in the key registry): the gate announces `nexusmd:sync-applied` with a `collId`, the desktop shell re-reads
  its tweaks and the Work screens store drops its cache (the phone already re-reads tweaks on that event);
- **reload** for everything else: anything that belongs to no profile (the profiles list, device prefs), data of the profile in use that is read when
  the app starts (documents, tokens, ...), or a pull that does not say what it wrote. Unknown always reloads, as before.

Each app passes the gate `activeProfileId()` and `isLiveSafe`. On the phone only the "other profile" case applies, since its tweaks are not synced field
by field.
