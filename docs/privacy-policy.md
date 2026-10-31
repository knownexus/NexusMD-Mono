# Nexus: Privacy Policy

_Last updated: <DATE>_

> **Draft for the app owner. Before publishing, replace every `<…>` and check each line marked
> "(verify)" against what the app and your server actually do. Play requires this at a public URL.**

Nexus ("the app") is an engineering-management client for Android. This policy says what data it
handles and where it goes.

## What stays on your device
Everything you enter or load is stored on your device: your connection settings (organisation,
site, email), the access tokens and API tokens you enter, your notes, planner, documents, calendar
entries and cached work items, pull requests and builds. Tokens are kept in the app's device storage
and are not copied into Android cloud backups. Uninstalling the app deletes this data.

## Services the app talks to
The app contacts only services you connect, using the credentials you give it, over HTTPS:
- **Azure DevOps** (`dev.azure.com`): work items, pull requests, builds, tests, repositories.
- **Jira Cloud** (your `*.atlassian.net` site): work items.
- **GitHub** (`api.github.com`): issues, pull requests, Actions runs, repositories.
- **Microsoft Outlook calendar** (Microsoft Graph), if you connect it.
- **Google Drive or OneDrive**, only if you turn on profile sync. Synced profile data is encrypted
  on your device with a passphrase before upload. (verify)

Those services are governed by their own privacy policies. The app does not send your data anywhere
else.

## Our server
Signing in to Google, Microsoft, Azure DevOps or GitHub for sync uses a sign-in page run at
`<your backend host, e.g. nexusmd.app>`. It exchanges the one-time sign-in code for tokens that are
then stored on your device. <State what the server keeps, if anything, and for how long. (verify)>

## What the app does not do
No advertising, no analytics or tracking SDKs, no sale or sharing of data, and no collection of
location, contacts, photos or device identifiers. (verify)

## Permissions
The app asks only for network access. Files you import or export are chosen through Android's
file picker.

## Your choices
You can remove any connection in Settings, delete a profile, or uninstall the app to remove local
data. Data you synced to Google Drive or OneDrive lives in your own account and you can delete it
there.

## Children
The app is not directed at children under 13.

## Changes
We will update this page when the app's data handling changes and change the date above.

## Contact
<your name or organisation> · <contact email>
