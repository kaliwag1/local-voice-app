// The actions a chat row offers, in the order they are shown: the two harmless
// toggles first, then the two that change what you can find later, separated so
// Delete is never the neighbour of Rename.
//
// Each carries the letter that runs it while the menu is open, which is also
// what the menu prints on the right.
export function chatMenuItems({ pinned = false, archived = false } = {}) {
  return [
    { id: 'pin', label: pinned ? 'Unpin' : 'Pin', shortcut: 'P' },
    { id: 'rename', label: 'Rename', shortcut: 'R' },
    { separator: true },
    { id: 'archive', label: archived ? 'Restore' : 'Archive', shortcut: 'A' },
    { id: 'delete', label: 'Delete', shortcut: 'D', danger: true },
  ]
}

export function shortcutAction(items, key) {
  if (!key || key.length !== 1) return null
  const match = items.find(item => item.shortcut?.toLowerCase() === key.toLowerCase())
  return match?.id || null
}
