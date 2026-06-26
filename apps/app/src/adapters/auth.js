// NOTE: Replace with capacitor-biometric-auth once that package is added.
export const authAdapter = {
  async isAvailable() {
    return false
  },
  async promptBiometric(_reason) {
    return false
  },
}
