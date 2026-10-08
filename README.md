# NexusMD

Single application, multiple platforms — consolidated monorepo.

## Layout

```
packages/
  core/          @nexusmd/core         headless domain logic + adapter contracts (no React/DOM)
  ui/            @nexusmd/ui           shared React components, CSS tokens, shared views
  web-adapters/  @nexusmd/web-adapters browser adapters shared by web/desktop/app
apps/
  app/           Capacitor / Android
  desktop/       Electron
  web/           browser frontend + ASP.NET host (server/) + xUnit tests (server-tests/)
```

## Develop

```
npm install            # one install links all workspaces
npm test               # all unit + contract tests (vitest)
npm run build          # build every workspace
```

Per workspace: `npm -w apps/web run dev`, `npm -w packages/core test`, etc.

## Personal Access Tokens (PAT)

### Azure DevOps

Create a PAT scoped to:

- **Work Items** — Read & Write (creating/updating work items, adding relations/attachments, posting comments)
- **Code** — Read & Write (voting on PRs, pushing branch refs, posting/resolving PR comment threads, editing PR descriptions)
- **Build** — Read & Execute (queuing/cancelling builds, e.g. deploy-to-UAT)
- **Test Management** — Read (test run results shown alongside build history)
- **Project and Team** — Read (listing teams/members, iterations, areas)

- **Web** — the PAT is stored server-side only (`Ado:Pat` in `appsettings.user.json`) and is never sent to the browser; requests are proxied through `AdoController`.
- **Desktop / App** — the PAT is stored locally on the device and sent directly to `dev.azure.com` via Basic auth.

### GitHub

Create a classic or fine-grained PAT scoped to:

- `repo`
- `read:org`

Accepted token prefixes: `ghp_`, `ghs_`, or `github_pat_`. On web, GitHub OAuth is available as an alternative to a PAT.

The four original repos (`NexusMD`, `NexusMD-App`, `NexusMD-Desktop`, `NexusMD-Web`)
were merged here with history preserved via `git subtree`. They are tagged
`pre-mono-merge` as rollback anchors.
