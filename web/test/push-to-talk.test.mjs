import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acceleratorLabel,
  matchesAcceleratorDown,
  matchesAcceleratorUp,
  parseAccelerator,
} from '../src/desktop/push-to-talk.js'

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

test('parses accelerators in the desktop grammar', () => {
  assert.deepEqual(parseAccelerator('F9'), { key: 'F9', command: false, alt: false, shift: false })
  assert.deepEqual(parseAccelerator('CommandOrControl+Shift+Space'), { key: 'Space', command: true, alt: false, shift: true })
  assert.equal(parseAccelerator(''), null)
})

test('keydown needs the exact modifier set', () => {
  assert.ok(matchesAcceleratorDown(key('F9'), 'F9'))
  assert.ok(!matchesAcceleratorDown(key('F9', { ctrlKey: true }), 'F9'))
  assert.ok(matchesAcceleratorDown(key(' ', { ctrlKey: true, shiftKey: true }), 'CommandOrControl+Shift+Space'))
  assert.ok(matchesAcceleratorDown(key('t', { altKey: true }), 'Alt+T'))
  assert.ok(!matchesAcceleratorDown(key('t'), 'Alt+T'))
})

test('keyup only needs the main key (modifiers may be released first)', () => {
  assert.ok(matchesAcceleratorUp(key(' '), 'CommandOrControl+Shift+Space'))
  assert.ok(!matchesAcceleratorUp(key('Shift'), 'CommandOrControl+Shift+Space'))
})

test('labels read naturally per platform', () => {
  assert.equal(acceleratorLabel('CommandOrControl+F9', 'Win32'), 'Ctrl + F9')
  assert.equal(acceleratorLabel('CommandOrControl+Space', 'MacIntel'), '⌘ + Space')
})
