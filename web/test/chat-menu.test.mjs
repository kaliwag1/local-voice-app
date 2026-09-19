import assert from 'node:assert/strict'
import test from 'node:test'
import { chatMenuItems, shortcutAction } from '../src/chat-menu.js'

test('lists the harmless toggles first and keeps Delete away from Rename', () => {
  const ids = chatMenuItems().map(item => item.separator ? '—' : item.id)
  assert.deepEqual(ids, ['pin', 'rename', '—', 'archive', 'delete'])
  assert.equal(chatMenuItems().find(item => item.id === 'delete').danger, true)
})

test('the toggles name the action, not the current state', () => {
  const on = chatMenuItems({ pinned: true, archived: true })
  assert.equal(on.find(item => item.id === 'pin').label, 'Unpin')
  assert.equal(on.find(item => item.id === 'archive').label, 'Restore')
  const off = chatMenuItems()
  assert.equal(off.find(item => item.id === 'pin').label, 'Pin')
  assert.equal(off.find(item => item.id === 'archive').label, 'Archive')
})

test('each printed letter runs its own item, in either case', () => {
  const items = chatMenuItems()
  assert.equal(shortcutAction(items, 'p'), 'pin')
  assert.equal(shortcutAction(items, 'R'), 'rename')
  assert.equal(shortcutAction(items, 'a'), 'archive')
  assert.equal(shortcutAction(items, 'D'), 'delete')
})

// Escape closes the menu and arrow keys move through it; neither should fire an action.
test('keys that are not a shortcut do nothing', () => {
  const items = chatMenuItems()
  for (const key of ['Escape', 'ArrowDown', 'Enter', 'x', '', null]) {
    assert.equal(shortcutAction(items, key), null, `${key} should not act`)
  }
})
