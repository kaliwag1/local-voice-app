// A system-wide key that fires once per press, such as the deafen key. Electron's
// globalShortcut takes the key from every other app while it is registered, so the
// Settings recorder pauses it; otherwise pressing the current key there would
// toggle instead of being recorded. '' means off.
export class GlobalToggleShortcut {
  constructor({ globalShortcut, onPress } = {}) {
    this.globalShortcut = globalShortcut
    this.press = () => onPress?.()
    this.accelerator = ''
    this.registered = false
    this.paused = false
  }

  // Returns false, keeping the previous key, when another app owns the new one.
  set(accelerator) {
    const next = String(accelerator || '')
    if (next === this.accelerator && (this.registered || !next)) return true
    if (this.paused) {
      this.accelerator = next
      return true
    }
    if (next && !this.globalShortcut.register(next, this.press)) return false
    if (this.registered && this.accelerator !== next) {
      this.globalShortcut.unregister(this.accelerator)
    }
    this.accelerator = next
    this.registered = Boolean(next)
    return true
  }

  pause() {
    if (this.registered) this.globalShortcut.unregister(this.accelerator)
    this.registered = false
    this.paused = true
  }

  resume() {
    this.paused = false
    this.registered = Boolean(this.accelerator)
      && this.globalShortcut.register(this.accelerator, this.press)
    return this.registered || !this.accelerator
  }

  stop() {
    if (this.registered) this.globalShortcut.unregister(this.accelerator)
    this.registered = false
  }
}
