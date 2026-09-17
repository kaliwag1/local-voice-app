import assert from 'node:assert/strict'
import test from 'node:test'

import { createPushToTalkHook, parseAccelerator } from '../src/push-to-talk-hook.mjs'

function fakeModule() {
  const handlers = { keydown: [], keyup: [] }
  return {
    started: 0, stopped: 0,
    UiohookKey: { F9: 120, Space: 57, A: 30, T: 20, ArrowUp: 61000, Digit1: 2 },
    uIOhook: {
      on: (type, fn) => handlers[type].push(fn),
      off: (type, fn) => { handlers[type] = handlers[type].filter(h => h !== fn) },
      start() { this.started = (this.started || 0) + 1 },
      stop() { this.stopped = (this.stopped || 0) + 1 },
    },
    handlers,
  }
}
const ev = (keycode, mods = {}) => ({ keycode, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })

test('parses the desktop accelerator grammar', () => {
  assert.deepEqual(parseAccelerator('CommandOrControl+Shift+Space'), { key: 'Space', command: true, alt: false, shift: true })
  assert.equal(parseAccelerator(''), null)
})

test('holds while the exact key combination is down and releases on the main key up', async () => {
  const mod = fakeModule()
  const changes = []
  const hook = createPushToTalkHook({ onChange: held => changes.push(held), load: async () => mod })
  assert.equal(await hook.setAccelerator('CommandOrControl+F9'), true)
  assert.equal(mod.uIOhook.started, 1)
  hook._handle('keydown', ev(120))                     // bare F9: wrong modifiers
  hook._handle('keydown', ev(120, { ctrlKey: true }))  // Ctrl+F9
  hook._handle('keydown', ev(120, { ctrlKey: true }))  // auto-repeat: no second event
  hook._handle('keyup', ev(120))                       // Ctrl already released: still counts
  assert.deepEqual(changes, [true, false])
  assert.equal(hook.held, false)
})

test('an empty accelerator stops the hook and reports it', async () => {
  const mod = fakeModule()
  const hook = createPushToTalkHook({ onChange: () => {}, load: async () => mod })
  await hook.setAccelerator('F9')
  assert.equal(hook.active, true)
  assert.equal(await hook.setAccelerator(''), false)
  assert.equal(hook.active, false)
  assert.equal(mod.uIOhook.stopped, 1)
})

test('a missing native module is reported as unavailable, not thrown', async () => {
  const hook = createPushToTalkHook({ onChange: () => {}, load: async () => { throw new Error('Cannot find module') } })
  assert.equal(await hook.setAccelerator('F9'), false)
  assert.equal(hook.available, false)
})

test('keys it cannot map are refused', async () => {
  const hook = createPushToTalkHook({ onChange: () => {}, load: async () => fakeModule() })
  assert.equal(await hook.setAccelerator('F24'), false)
  assert.equal(await hook.setAccelerator('Alt+Up'), true)
})
