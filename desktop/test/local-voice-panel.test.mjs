import assert from 'node:assert/strict'
import test from 'node:test'
import { voiceGroups } from '../src/local-voice-panel.js'

const presets = [{ id: 'jean', label: 'Jean', kind: 'preset' }, { id: 'cosette', label: 'Cosette', kind: 'preset' }]
const clones = [{ id: 'jake.wav', label: 'jake.wav', kind: 'file' }]

test('separates shipped presets from clips cloned out of the voices folder', () => {
  assert.deepEqual(voiceGroups([...presets, ...clones]), [
    { label: 'Built-in', options: presets },
    { label: 'My voices folder', options: clones },
  ])
})

test('drops a group that has nothing in it', () => {
  assert.deepEqual(voiceGroups(presets).map(group => group.label), ['Built-in'])
  assert.deepEqual(voiceGroups(clones).map(group => group.label), ['My voices folder'])
})

// Remote runtimes report no voices; the row hides rather than showing an empty box.
test('no voices at all means no groups', () => {
  assert.deepEqual(voiceGroups([]), [])
  assert.deepEqual(voiceGroups(), [])
})
