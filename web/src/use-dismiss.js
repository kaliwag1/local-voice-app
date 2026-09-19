import { useEffect, useRef } from 'react'

// A <details> popover in the composer should behave like a menu: clicking
// anywhere else puts it away, and Escape closes it without moving the mouse.
// Left to itself, <details> only closes when its own summary is clicked again,
// so two of these could sit open over the conversation at once.
export function dismisses(details, event) {
  if (!details?.open) return false
  if (event?.type === 'keydown') return event.key === 'Escape'
  // A click on the summary is the element's own toggle; leave that alone.
  return !details.contains?.(event?.target)
}

export function useDismissOnOutside() {
  const ref = useRef(null)
  useEffect(() => {
    const handle = event => {
      if (dismisses(ref.current, event)) ref.current.open = false
    }
    // Capture phase, so a click that opens another popover still closes this
    // one even if that handler stops the event.
    document.addEventListener('pointerdown', handle, true)
    document.addEventListener('keydown', handle, true)
    return () => {
      document.removeEventListener('pointerdown', handle, true)
      document.removeEventListener('keydown', handle, true)
    }
  }, [])
  return ref
}
