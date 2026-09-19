import { chatMenuItems, shortcutAction } from './chat-menu.js'
import { useDismissOnOutside } from './use-dismiss.js'

// One button per chat instead of four icons: the row stays readable, and the
// actions - two of which are destructive or hard to undo - sit behind a
// deliberate click. It appears on hover, and on keyboard focus, so it is never
// reachable by mouse alone.
export default function ChatItemMenu({
  pinned = false,
  archived = false,
  onRename,
  onTogglePin,
  onToggleArchive,
  onDelete,
}) {
  const ref = useDismissOnOutside()
  const items = chatMenuItems({ pinned, archived })
  const handlers = { pin: onTogglePin, rename: onRename, archive: onToggleArchive, delete: onDelete }
  const close = element => element?.closest('details')?.removeAttribute('open')
  const run = id => event => {
    close(event.currentTarget)
    handlers[id]?.()
  }
  // The chat list scrolls, so an absolutely positioned menu would be clipped by
  // it. Place the open menu against the viewport, flipping above the button
  // only when there is genuinely no room below.
  //
  // A fixed element is positioned against the nearest transformed ancestor
  // rather than the viewport, and this app has several. So instead of trusting
  // viewport coordinates, pin the menu at 0,0, measure where that actually
  // landed, and shift it by the difference. That holds wherever it is nested.
  const place = event => {
    const details = event.currentTarget
    const body = details.querySelector('.chat-item-menu-body')
    const summary = details.querySelector('summary')
    if (!details.open || !body || !summary) return
    body.style.position = 'fixed'
    body.style.left = '0px'
    body.style.top = '0px'
    // 'auto', not '': the stylesheet pins right/bottom for the unscripted case,
    // and an inline left with a stylesheet right stretches the menu edge to edge.
    body.style.right = 'auto'
    body.style.bottom = 'auto'
    const origin = body.getBoundingClientRect()
    const anchor = summary.getBoundingClientRect()
    const width = body.offsetWidth
    const height = body.offsetHeight
    const below = window.innerHeight - anchor.bottom > height + 8
    const wantedLeft = Math.min(
      Math.max(anchor.right - width, 8),
      Math.max(window.innerWidth - width - 8, 8),
    )
    const wantedTop = below
      ? Math.min(anchor.bottom + 4, window.innerHeight - height - 8)
      : Math.max(anchor.top - height - 4, 8)
    body.style.left = `${Math.round(wantedLeft - origin.left)}px`
    body.style.top = `${Math.round(wantedTop - origin.top)}px`
  }
  const onKeyDown = event => {
    const details = event.currentTarget
    if (!details.open) return
    const id = shortcutAction(items, event.key)
    if (!id) return
    event.preventDefault()
    close(details)
    handlers[id]?.()
  }
  return <details ref={ref} className="chat-item-menu" onToggle={place} onKeyDown={onKeyDown}>
    <summary title="Chat options" aria-label="Chat options"><span aria-hidden="true">⋮</span></summary>
    <div className="chat-item-menu-body" role="menu">
      {items.map((item, index) => (item.separator
        ? <hr key={`separator-${index}`} />
        : <button
          key={item.id}
          type="button"
          role="menuitem"
          className={item.danger ? 'danger' : undefined}
          onClick={run(item.id)}
        >{item.label}<span className="chat-item-menu-key" aria-hidden="true">{item.shortcut}</span></button>))}
    </div>
  </details>
}
