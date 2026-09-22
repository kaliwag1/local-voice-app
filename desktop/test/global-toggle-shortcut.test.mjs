import assert from 'node:assert/strict'
import test from 'node:test'

import { GlobalToggleShortcut } from '../src/global-toggle-shortcut.mjs'

function fakeGlobalShortcut({ taken = [] } = {}) {
  const handlers = new Map()
  return {
    handlers,
    register(accelerator, handler) {
      if (taken.includes(accelerator) || handlers.has(accelerator)) return false
      handlers.set(accelerator, handler)
      return true
    },
    unregister(accelerator) {
      handlers.delete(accelerator)
    },
  }
}

test('a registered key calls back on every press', () => {
  const globalShortcut = fakeGlobalShortcut()
  let presses = 0
  const shortcut = new GlobalToggleShortcut({ globalShortcut, onPress: () => presses++ })
  assert.equal(shortcut.set('CommandOrControl+Alt+D'), true)
  globalShortcut.handlers.get('CommandOrControl+Alt+D')()
  globalShortcut.handlers.get('CommandOrControl+Alt+D')()
  assert.equal(presses, 2)
  assert.equal(shortcut.registered, true)
})

test('changing the key releases the old one', () => {
  const globalShortcut = fakeGlobalShortcut()
  const shortcut = new GlobalToggleShortcut({ globalShortcut })
  shortcut.set('CommandOrControl+Alt+D')
  assert.equal(shortcut.set('F8'), true)
  assert.deepEqual([...globalShortcut.handlers.keys()], ['F8'])
  assert.equal(shortcut.accelerator, 'F8')
})

test('a key owned by another app is refused and the old key kept', () => {
  const globalShortcut = fakeGlobalShortcut({ taken: ['F8'] })
  const shortcut = new GlobalToggleShortcut({ globalShortcut })
  shortcut.set('CommandOrControl+Alt+D')
  assert.equal(shortcut.set('F8'), false)
  assert.equal(shortcut.accelerator, 'CommandOrControl+Alt+D')
  assert.deepEqual([...globalShortcut.handlers.keys()], ['CommandOrControl+Alt+D'])
})

test('an empty key turns it off', () => {
  const globalShortcut = fakeGlobalShortcut()
  const shortcut = new GlobalToggleShortcut({ globalShortcut })
  shortcut.set('CommandOrControl+Alt+D')
  assert.equal(shortcut.set(''), true)
  assert.equal(globalShortcut.handlers.size, 0)
  assert.equal(shortcut.registered, false)
})

test('pausing frees the key for the recorder and resuming takes it back', () => {
  const globalShortcut = fakeGlobalShortcut()
  const shortcut = new GlobalToggleShortcut({ globalShortcut })
  shortcut.set('CommandOrControl+Alt+D')
  shortcut.pause()
  assert.equal(globalShortcut.handlers.size, 0)
  assert.equal(shortcut.resume(), true)
  assert.deepEqual([...globalShortcut.handlers.keys()], ['CommandOrControl+Alt+D'])
})

test('a key that failed at startup can be retried', () => {
  const taken = ['CommandOrControl+Alt+D']
  const globalShortcut = fakeGlobalShortcut({ taken })
  const shortcut = new GlobalToggleShortcut({ globalShortcut })
  assert.equal(shortcut.set('CommandOrControl+Alt+D'), false)
  taken.length = 0
  assert.equal(shortcut.set('CommandOrControl+Alt+D'), true)
  assert.equal(shortcut.registered, true)
})
