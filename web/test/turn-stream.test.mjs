import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDuration, formatRate, isActive, streamLabel, streamStats } from '../src/turn-stream.js'

const turn = (overrides = {}) => ({
  turnId: 't', status: 'working', live: true, createdAt: 1_000,
  stream: { deltas: 0, characters: 0, firstDeltaAt: null, endedAt: null },
  usage: null,
  ...overrides,
})

test('a running turn shows a clock and what has streamed, with no token claim', () => {
  const activity = turn({ stream: { deltas: 120, characters: 480, firstDeltaAt: 1_500, endedAt: null } })
  const stats = streamStats(activity, 9_000)
  assert.equal(stats.live, true)
  assert.equal(stats.elapsedMs, 8_000)
  assert.equal(stats.characters, 480)
  assert.equal(stats.tokens, null)
  assert.equal(stats.tokensPerSecond, null)
  assert.equal(streamLabel(activity, 9_000), '8.0s · 480 characters')
})

test('a finished turn stops its clock where the runtime stopped', () => {
  const activity = turn({
    status: 'completed', live: false,
    stream: { deltas: 300, characters: 1200, firstDeltaAt: 2_000, endedAt: 8_000 },
    usage: { input: 4278, output: 1504, total: 5782, latest: { input: 4278, output: 1504, total: 5782 } },
  })
  // Long after the fact, the reading is still the turn's own duration.
  const stats = streamStats(activity, 900_000)
  assert.equal(stats.elapsedMs, 7_000)
  assert.equal(stats.tokens, 1504)
  // Rate is over generation (8000-2000), not the whole turn.
  assert.equal(Math.round(stats.tokensPerSecond), 251)
  assert.equal(streamLabel(activity, 900_000), '7.0s · 1,504 tokens · 250.7 tok/s')
})

test('prompt processing time is left out of the generation rate', () => {
  const slowPrompt = turn({
    status: 'completed', live: false,
    stream: { deltas: 10, characters: 40, firstDeltaAt: 31_000, endedAt: 41_000 },
    usage: { output: 1000, latest: { input: 10, output: 1000, total: 1010 } },
  })
  assert.equal(streamStats(slowPrompt, 41_000).tokensPerSecond, 100)
})

test('no rate is claimed from a window too short to measure', () => {
  const instant = turn({
    status: 'completed', live: false,
    stream: { deltas: 1, characters: 4, firstDeltaAt: 1_100, endedAt: 1_200 },
    usage: { output: 3, latest: { input: 5, output: 3, total: 8 } },
  })
  assert.equal(streamStats(instant, 1_200).tokensPerSecond, null)
  assert.equal(streamLabel(instant, 1_200), '0.2s · 3 tokens')
})

test('a restored turn is not treated as still running', () => {
  assert.equal(isActive(turn({ live: false })), false)
  assert.equal(isActive(turn({ status: 'completed' })), false)
  assert.equal(isActive(turn()), true)
})

test('formats durations and rates for reading', () => {
  assert.equal(formatDuration(1_234), '1.2s')
  assert.equal(formatDuration(95_000), '1m 35s')
  assert.equal(formatDuration(Number.NaN), null)
  assert.equal(formatRate(75.43), '75.4 tok/s')
  assert.equal(formatRate(null), null)
})

// Turns from before the stream counters have no endedAt. Measuring them against
// the clock made restored chats report "56m 22s" for a reply that took seconds.
test('a finished turn with no recorded end stops at its last update', () => {
  const legacy = { turnId: 't', status: 'completed', live: false, createdAt: 1_000, updatedAt: 4_000, usage: null }
  assert.equal(streamLabel(legacy, 900_000), '3.0s')
  assert.equal(streamStats(legacy, 900_000).elapsedMs, 3_000)
})

test('a running turn is still measured against the clock', () => {
  const running = {
    turnId: 't', status: 'working', live: true, createdAt: 1_000, updatedAt: 2_000,
    stream: { deltas: 5, characters: 20, firstDeltaAt: 1_500, endedAt: null }, usage: null,
  }
  assert.equal(streamStats(running, 9_000).elapsedMs, 8_000)
})
