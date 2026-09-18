// A shutdown step that never settles would leave the user in a half-closed app
// with no window and no way to quit, so callers bound the slow ones and carry on
// with a fallback result instead of waiting.
export function withDeadline(work, ms, fallback, timers = { set: setTimeout, clear: clearTimeout }) {
  let timer
  const expiry = new Promise(resolve => { timer = timers.set(() => resolve(fallback), ms) })
  return Promise.race([work, expiry]).finally(() => timers.clear(timer))
}

export function createGracefulShutdown({
  app,
  cleanup,
  onError = () => {},
} = {}) {
  let closing = false
  let complete = false

  return event => {
    if (complete) return
    event?.preventDefault?.()
    if (closing) return
    closing = true
    Promise.resolve()
      .then(() => cleanup?.())
      .catch(error => onError(error))
      .finally(() => {
        complete = true
        app.quit()
      })
  }
}
