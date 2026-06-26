export const authAdapter = {
  async isAvailable() {
    try {
      return typeof PublicKeyCredential !== 'undefined' &&
        await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch { return false; }
  },
  async promptBiometric(reason) {
    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge:        crypto.getRandomValues(new Uint8Array(32)),
          rpId:             window.location.hostname || 'localhost',
          allowCredentials: [],
          userVerification: 'required',
          timeout:          60_000,
        },
      });
      return !!credential;
    } catch { return false; }
  },
}
