import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSessionHeader, normalizeSessionEvent } from '../../shared/session-events.mjs'
import { listSessionSummaries } from '../src/session/session-summaries.mjs'

function journal(ownerId, sessionId, content, time) {
  return {
    records: [
      createSessionHeader({ ownerId, sessionId, createdAt: time }),
      normalizeSessionEvent({
        type: 'user/message',
        payload: { messageId: `${sessionId}-user`, content },
      }, { sessionId, seq: 1, time }),
    ],
  }
}

test('lists only the owner sessions, with first user message titles and recent first', async () => {
  const files = [
    journal('mine', 'older', '  First   task  ', '2026-09-01T10:00:00Z'),
    journal('other', 'secret', 'Private text', '2026-09-16T10:00:00Z'),
    journal('mine', 'newer', 'Second task', '2026-09-15T10:00:00Z'),
  ]
  const registry = { async flush() {}, *iterateSync() { yield* files } }
  const sessions = await listSessionSummaries(registry, 'mine')
  assert.deepEqual(sessions.map(item => [item.sessionId, item.title]), [
    ['newer', 'Second task'],
    ['older', 'First task'],
  ])
  assert.equal(JSON.stringify(sessions).includes('Private text'), false)
})

test('a newly created empty chat remains visible', async () => {
  const registry = {
    async flush() {},
    *iterateSync() {
      yield { records: [createSessionHeader({
        ownerId: 'mine',
        sessionId: 'empty',
        createdAt: '2026-09-16T10:00:00Z',
      })] }
    },
  }
  const sessions = await listSessionSummaries(registry, 'mine')
  assert.equal(sessions[0].title, 'New chat')
  assert.equal(sessions[0].sessionId, 'empty')
})
