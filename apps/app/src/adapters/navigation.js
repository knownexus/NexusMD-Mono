let _backHandler = null

export const navigationAdapter = {
  onBackButton(cb) {
    // No Capacitor App plugin — passive listener only fires via synthetic events
    const handler = (e) => { if (e.type === 'popstate') cb() }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  },
  canGoBack() {
    return window.history.length > 1
  },
  goBack() {
    window.history.back()
  },
  setBackButtonHandler(cb) {
    _backHandler = cb
    const handler = (e) => {
      e.preventDefault()
      if (_backHandler) _backHandler()
    }
    window.addEventListener('popstate', handler)
    return () => {
      _backHandler = null
      window.removeEventListener('popstate', handler)
    }
  },
}
