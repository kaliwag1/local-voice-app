import assert from 'node:assert/strict'
import test from 'node:test'

import {
  confirmTrackedPlaybackStart,
  planPlaybackDeafen,
} from '../src/realtime/playback-lifecycle.js'

function playback() {
  return {
    startTimers: new Map(),
    startedResponses: new Set(),
    sourceCounts: new Map([['response-1', 1]]),
  }
}

test('confirms a tracked response exactly once and clears its timer', () => {
  const state = playback()
  const timer = { id: 'timer-1' }
  const cleared = []
  const started = []
  state.startTimers.set('response-1', timer)

  assert.equal(confirmTrackedPlaybackStart(
    state,
    'response-1',
    id => started.push(id),
    value => cleared.push(value),
  ), true)
  assert.equal(confirmTrackedPlaybackStart(
    state,
    'response-1',
    id => started.push(id),
  ), false)
  assert.deepEqual(started, ['response-1'])
  assert.deepEqual(cleared, [timer])
  assert.equal(state.startTimers.has('response-1'), false)
})

test('does not acknowledge a source removed by interruption', () => {
  const state = playback()
  state.sourceCounts.clear()

  assert.equal(confirmTrackedPlaybackStart(
    state,
    'response-1',
    () => assert.fail('cleared playback must not be acknowledged'),
  ), false)
})

function inFlight(overrides = {}) {
  return {
    startTimers: new Map(),
    endTimers: new Map(),
    startedResponses: new Set(),
    sourceCounts: new Map(),
    doneResponses: new Set(),
    failedResponses: new Set(),
    queue: null,
    ...overrides,
  }
}

test('deafening a playing response keeps it open until its audio is done', () => {
  const plan = planPlaybackDeafen(inFlight({
    startedResponses: new Set(['playing']),
    sourceCounts: new Map([['playing', 2]]),
  }))
  assert.deepEqual(plan, { started: [], ended: [], muted: ['playing'] })
})

test('deafening a response that has not started acknowledges its start', () => {
  const plan = planPlaybackDeafen(inFlight({
    startTimers: new Map([['scheduled', 1]]),
    sourceCounts: new Map([['scheduled', 1]]),
  }))
  assert.deepEqual(plan, { started: ['scheduled'], ended: [], muted: ['scheduled'] })
})

test('deafening a response whose audio already finished ends it now', () => {
  const plan = planPlaybackDeafen(inFlight({
    startedResponses: new Set(['tail']),
    doneResponses: new Set(['tail']),
    endTimers: new Map([['tail', 1]]),
  }))
  assert.deepEqual(plan, { started: [], ended: ['tail'], muted: [] })
})

test('deafening covers audio still held in the jitter queue', () => {
  const plan = planPlaybackDeafen(inFlight({
    queue: { responseIds: () => ['queued'] },
  }))
  assert.deepEqual(plan, { started: ['queued'], ended: [], muted: ['queued'] })
})

test('deafening leaves failed responses alone', () => {
  const plan = planPlaybackDeafen(inFlight({
    sourceCounts: new Map([['broken', 1]]),
    failedResponses: new Set(['broken']),
  }))
  assert.deepEqual(plan, { started: [], ended: [], muted: [] })
})
