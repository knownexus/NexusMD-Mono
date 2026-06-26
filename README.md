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

The four original repos (`NexusMD`, `NexusMD-App`, `NexusMD-Desktop`, `NexusMD-Web`)
were merged here with history preserved via `git subtree`. They are tagged
`pre-mono-merge` as rollback anchors.
