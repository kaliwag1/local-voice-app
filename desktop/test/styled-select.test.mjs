import assert from 'node:assert/strict'
import test from 'node:test'
import { matchOption, selectEntries } from '../src/styled-select.js'

const option = (value, text, extra = {}) => ({ tagName: 'OPTION', value, textContent: ` ${text} `, selected: false, disabled: false, hidden: false, ...extra })
const group = (label, children, extra = {}) => ({ tagName: 'OPTGROUP', label, children, disabled: false, ...extra })

test('lists options in order, trimmed, with the selected one marked', () => {
  const entries = selectEntries({ children: [option('always', 'Always on', { selected: true }), option('push-to-talk', 'Push to talk')] })
  assert.deepEqual(entries, [
    { kind: 'option', value: 'always', label: 'Always on', selected: true, disabled: false },
    { kind: 'option', value: 'push-to-talk', label: 'Push to talk', selected: false, disabled: false },
  ])
})

test('keeps group headings, and a disabled group disables its options', () => {
  const entries = selectEntries({ children: [
    group('Built-in', [option('jean', 'Jean')]),
    group('My voices folder', [option('jake.wav', 'jake')], { disabled: true }),
  ] })
  assert.deepEqual(entries.map(entry => [entry.kind, entry.label, entry.disabled]), [
    ['group', 'Built-in', undefined],
    ['option', 'Jean', false],
    ['group', 'My voices folder', undefined],
    ['option', 'jake', true],
  ])
})

test('leaves hidden options out', () => {
  const entries = selectEntries({ children: [option('a', 'A'), option('b', 'B', { hidden: true })] })
  assert.deepEqual(entries.map(entry => entry.value), ['a'])
})

test('type-ahead finds the next enabled match and wraps around', () => {
  const options = [
    { label: 'Voice', disabled: false },
    { label: 'Text only', disabled: false },
    { label: 'Tablet', disabled: true },
    { label: 'Tiny', disabled: false },
  ]
  assert.equal(matchOption(options, 't'), 1)
  assert.equal(matchOption(options, 't', 1), 3)
  assert.equal(matchOption(options, 't', 3), 1)
  assert.equal(matchOption(options, 'TEX'), 1)
  assert.equal(matchOption(options, 'x'), -1)
})
