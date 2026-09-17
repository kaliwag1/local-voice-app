// Push-to-talk key matching for the desktop panel. The accelerator uses the same grammar as
// the desktop wake shortcut ("F9", "CommandOrControl+Shift+Space", "Alt+T"); the key is
// handled by the renderer, so it only works while the chat panel is focused.

function normalizeEventKey(key) {
  if (key === ' ' || key === 'Spacebar') return 'Space'
  if (typeof key === 'string' && key.startsWith('Arrow')) return key.slice(5)
  if (typeof key === 'string' && key.length === 1) return key.toUpperCase()
  return key
}

export function parseAccelerator(accelerator) {
  const parts = String(accelerator || '').split('+').map(part => part.trim()).filter(Boolean)
  if (!parts.length) return null
  const key = parts.pop()
  return {
    key,
    command: parts.includes('CommandOrControl') || parts.includes('Control') || parts.includes('Command'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
  }
}

// keydown: every modifier must match exactly, so "Ctrl+F9" does not fire on a bare F9.
export function matchesAcceleratorDown(event, accelerator) {
  const parsed = parseAccelerator(accelerator)
  if (!parsed) return false
  if (normalizeEventKey(event.key) !== parsed.key) return false
  const command = Boolean(event.ctrlKey || event.metaKey)
  return command === parsed.command
    && Boolean(event.altKey) === parsed.alt
    && Boolean(event.shiftKey) === parsed.shift
}

// keyup: modifiers may already be released, so only the main key counts.
export function matchesAcceleratorUp(event, accelerator) {
  const parsed = parseAccelerator(accelerator)
  return Boolean(parsed) && normalizeEventKey(event.key) === parsed.key
}

export function acceleratorLabel(accelerator, platform = '') {
  const mac = /mac/i.test(platform)
  const labels = {
    CommandOrControl: mac ? '⌘' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Shift: 'Shift',
    Space: 'Space',
  }
  return String(accelerator || '').split('+').map(part => labels[part] || part).join(' + ')
}
