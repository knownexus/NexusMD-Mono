// Native PKCE sign-in, run in the Electron main process. start() resolves with the
// provider's tokens; refresh() exchanges a refresh token (which may rotate).
const api = () => window.electronAPI

export const oauthAdapter = {
  start(provider) { return api().oauth.start(provider) },
  refresh(refreshToken, provider) { return api().oauth.refresh(refreshToken, provider) },
}
