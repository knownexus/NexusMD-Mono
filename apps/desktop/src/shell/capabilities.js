import { createCapabilities } from '@nexusmd/shell-sdk'

// What installed apps offer each other and the shell: provide(name, fn) / has(name) / call(name, ...args).
// Its own file so shell code the host object uses (the offline queue) can reach it without a cycle.
export const capabilities = createCapabilities()
