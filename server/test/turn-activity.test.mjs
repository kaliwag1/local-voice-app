import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TurnActivity, usageCounts } from '../src/voice/turn-activity.mjs'
import { replaySession } from '../src/session/session-replay.mjs'
import { createSessionHeader, normalizeSessionEvent } from '../../shared/session-events.mjs'

function harness() {
  const events = []; let now = 1000
  const tracker = new TurnActivity({ emit: value => events.push(value), now: () => now })
  const context = { turnId: 'turn1', origin: 'model' }
  return { tracker, events, context, tick: () => { now += 1000 } }
}
test('usage uses reported counts, preserves missing fields, and deduplicates response completion', () => {
  assert.equal(usageCounts(undefined), null)
  assert.deepEqual(usageCounts({ prompt_tokens: 12, completion_tokens: 3 }), { input: 12, output: 3, total: 15 })
  assert.deepEqual(usageCounts({ input_tokens: 0 }), { input: 0, output: null, total: null })
  const { tracker, events, context } = harness()
  try {
    tracker.handle({ type: 'response.created', response: { id: 'r1' } }, context)
    const done = { response: { id: 'r1', status: 'completed', usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } }
    tracker.done(done, { ...context, assistantTranscript: 'hello' })
    tracker.done(done, { ...context, assistantTranscript: 'hello' })
    assert.equal(events.at(-1).usage.total, 15)
    assert.equal(events.at(-1).status, 'completed')
  } finally { tracker.close() }
})
test('ten repeated searches remain visible without leaking arguments or results; terminal loop has a reason', () => {
  const { tracker, events, context } = harness()
  try {
    for (let i = 0; i < 10; i++) {
      tracker.handle({ type: 'response.created', response: { id: `r${i}` } }, context)
      tracker.tool({ turnId: 'turn1', callId: `call${i}`, name: 'web_search', status: 'received', arguments: { query: 'private query' } })
      tracker.tool({ turnId: 'turn1', callId: `call${i}`, name: 'web_search', status: 'completed', result: 'private result' })
      tracker.done({ response: { id: `r${i}`, status: 'completed', usage: { input_tokens: 10, output_tokens: 2 } } }, context, { pending: i < 9, terminalTool: i === 9 })
    }
    assert.equal(events.at(-1).tools.length, 10)
    assert.equal(events.at(-1).usage.total, 120)
    assert.equal(events.at(-1).status, 'no-answer')
    assert.match(events.at(-1).message, /Tool processing stopped/)
    assert.doesNotMatch(JSON.stringify(events), /private query|private result/)
  } finally { tracker.close() }
})
test('thinking is absent unless explicitly emitted; bounded text persists independently of answer', () => {
  const { tracker, events, context, tick } = harness()
  try {
    tracker.handle({ type: 'response.created', response: { id: 'r1' } }, context)
    assert.equal(events.at(-1).reasoning, '')
    tick()
    tracker.handle({ type: 'response.reasoning_text.delta', response_id: 'r1', delta: 'Checking the arithmetic.' }, context)
    tick()
    tracker.handle({ type: 'response.reasoning_text.delta', response_id: 'r1', delta: 'a'.repeat(25000) }, context)
    tracker.done({ response: { id: 'r1', status: 'completed' } }, context)
    assert.equal(events.at(-1).reasoning.length, 24000)
    assert.equal(events.at(-1).reasoningTruncated, true)
    assert.equal(events.at(-1).usage, null)
    const records = [createSessionHeader({ sessionId: 's' }), ...events.map((payload, index) => normalizeSessionEvent({ type: 'qwaudio/turn/activity', turnId: 'turn1', payload }, { sessionId: 's', seq: index + 1 }))]
    const replay = replaySession(records)
    assert.equal(replay.activities.length, 1)
    assert.equal(replay.activities[0].reasoning.length, 24000)
    assert.equal(replay.messages.length, 0, 'activity must never enter the model conversation')
  } finally { tracker.close() }
})
test('new input interrupts a waiting tool loop; late completion cannot resurrect it', () => {
  const { tracker, events, context } = harness()
  try {
    tracker.start('turn1')
    tracker.handle({ type: 'response.created', response: { id: 'r1' } }, context)
    tracker.done({ response: { id: 'r1', status: 'completed' } }, context, { pending: true })
    tracker.start('turn2')
    tracker.done({ response: { id: 'r1', status: 'completed' } }, context)
    assert.equal(events.filter(e => e.turnId === 'turn1').at(-1).status, 'interrupted')
  } finally { tracker.close() }
})
test('stall status is honest and does not fabricate failure or token usage', async () => {
  const events = []
  const tracker = new TurnActivity({ emit: e => events.push(e), idleMs: 5 })
  try {
    tracker.start('turn')
    await new Promise(r => setTimeout(r, 15))
    assert.equal(events.at(-1).status, 'waiting')
    assert.equal(events.at(-1).usage, null)
    tracker.fail('turn')
    assert.equal(events.at(-1).status, 'failed')
  } finally { tracker.close() }
})

test('agent-origin tool continuations contribute reasoning, usage, and final status', () => {
  const { tracker, events, context, tick } = harness()
  try {
    tracker.handle({ type: 'response.created', response: { id: 'r1' } }, context)
    tracker.done({ response: { id: 'r1', usage: { input_tokens: 10, output_tokens: 2 } } }, context, { pending: true })
    const followup = { ...context, origin: 'agent' }
    tracker.handle({ type: 'response.created', response: { id: 'r2' } }, followup)
    tick()
    tracker.handle({ type: 'response.reasoning_text.delta', response_id: 'r2', delta: 'Compare the results.' }, followup)
    tracker.done({ response: { id: 'r2', usage: { input_tokens: 20, output_tokens: 3 } } }, { ...followup, assistantTranscript: 'Found it.' })
    assert.equal(events.at(-1).status, 'completed')
    assert.equal(events.at(-1).usage.total, 35)
    assert.equal(events.at(-1).responseCount, 2)
    assert.equal(events.at(-1).reasoning, 'Compare the results.')
    tracker.done({ response: { id: 'system', usage: { input_tokens: 50, output_tokens: 5 } } }, { ...context, origin: 'permission' })
    assert.equal(events.at(-1).usage.total, 35, 'permission speech must not contaminate user turn usage')
  } finally { tracker.close() }
})
