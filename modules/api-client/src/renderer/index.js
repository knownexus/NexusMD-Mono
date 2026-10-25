import { ApiClientApp } from './api-client-app.jsx'
import { scriptRunnerAdapter } from './script-runner-adapter.js'
import { rawHttpAdapter } from './raw-http-adapter.js'

// What the shell gets from the API Client app (see apps/desktop/src/shell/modules.js).
//   adapters  added to the core adapter set before initCore, which is what enables the api-client module
//   views     view id -> component, rendered as <View adapters={...} host={...} />
export default {
  id: 'api-client',
  adapters: { scriptRunner: scriptRunnerAdapter, apiHttp: rawHttpAdapter },
  views: { 'api-client': ApiClientApp },
}
