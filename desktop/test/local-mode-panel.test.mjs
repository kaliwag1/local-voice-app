import assert from 'node:assert/strict'
import test from 'node:test'
import { APP_MODE_OPTIONS, appModeHint } from '../src/local-mode-panel.js'

test('offers voice and text only, voice first', () => {
  assert.deepEqual(APP_MODE_OPTIONS.map(option => option.id), ['voice', 'text'])
})

test('the hint says what each mode leaves out', () => {
  assert.match(appModeHint('text'), /no microphone/)
  assert.match(appModeHint('voice'), /spoken/)
  assert.equal(appModeHint('anything'), appModeHint('voice'))
})
