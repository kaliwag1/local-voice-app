import assert from 'node:assert/strict'
import test from 'node:test'
import { dismisses } from '../src/use-dismiss.js'

const inside = { id: 'inside' }
const elsewhere = { id: 'elsewhere' }
const details = (open = true) => ({ open, contains: target => target === inside })

test('a click elsewhere puts an open popover away', () => {
  assert.equal(dismisses(details(), { type: 'pointerdown', target: elsewhere }), true)
})

test('a click on its own summary is left to the element to toggle', () => {
  assert.equal(dismisses(details(), { type: 'pointerdown', target: inside }), false)
})

test('a closed popover needs no dismissing', () => {
  assert.equal(dismisses(details(false), { type: 'pointerdown', target: elsewhere }), false)
  assert.equal(dismisses(null, { type: 'pointerdown', target: elsewhere }), false)
})

test('Escape closes it, other keys do not', () => {
  assert.equal(dismisses(details(), { type: 'keydown', key: 'Escape' }), true)
  assert.equal(dismisses(details(), { type: 'keydown', key: 'a' }), false)
  // Typing in the field must not close the model list mid-read.
  assert.equal(dismisses(details(), { type: 'keydown', key: 'Enter', target: elsewhere }), false)
})
