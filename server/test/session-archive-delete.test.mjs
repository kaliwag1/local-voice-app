import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionJournalRegistry } from '../src/session/session-journal-registry.mjs'
import { listSessionSummaries } from '../src/session/session-summaries.mjs'

async function withRegistry(run) {
  const directory = await mkdtemp(join(tmpdir(), 'qwaudio-sessions-'))
  try {
    await run(new SessionJournalRegistry({ directory }), directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('archiving is reversible and shows up in session summaries', async () => {
  await withRegistry(async registry => {
    await registry.append({ ownerId: 'me', sessionId: 'a', event: {
      type: 'user/message', payload: { messageId: 'm1', content: 'Plan the shoot' },
    } })
    await registry.append({ ownerId: 'me', sessionId: 'b', event: {
      type: 'user/message', payload: { messageId: 'm2', content: 'Invoice draft' },
    } })
    await registry.flush()

    let sessions = await listSessionSummaries(registry, 'me')
    assert.deepEqual(sessions.map(item => item.archived), [false, false])

    await registry.updateMeta('me', 'a', { archived: true })
    sessions = await listSessionSummaries(registry, 'me')
    assert.equal(sessions.find(item => item.sessionId === 'a').archived, true)
    assert.equal(sessions.find(item => item.sessionId === 'b').archived, false)
    // The journal itself is untouched by archiving.
    assert.equal((await registry.read('me', 'a')).length, 2)

    await registry.updateMeta('me', 'a', { archived: false })
    sessions = await listSessionSummaries(registry, 'me')
    assert.equal(sessions.find(item => item.sessionId === 'a').archived, false)
  })
})

test('deleting removes only that session directory and forgets the journal', async () => {
  await withRegistry(async (registry, directory) => {
    await registry.append({ ownerId: 'me', sessionId: 'keep', event: {
      type: 'user/message', payload: { messageId: 'k', content: 'keep me' },
    } })
    await registry.append({ ownerId: 'me', sessionId: 'gone', event: {
      type: 'user/message', payload: { messageId: 'g', content: 'delete me' },
    } })
    await registry.flush()
    assert.equal(await registry.exists('me', 'gone'), true)

    await registry.delete('me', 'gone')

    assert.equal(await registry.exists('me', 'gone'), false)
    assert.equal(await registry.exists('me', 'keep'), true)
    const sessions = await listSessionSummaries(registry, 'me')
    assert.deepEqual(sessions.map(item => item.sessionId), ['keep'])
    const owners = await readdir(directory)
    assert.equal(owners.length, 1)
    // A fresh journal for the same id starts empty rather than resurrecting old events.
    assert.equal((await registry.read('me', 'gone')).length, 1)
  })
})

test('deleting an unknown session is a no-op exists check for callers', async () => {
  await withRegistry(async registry => {
    assert.equal(await registry.exists('me', 'never'), false)
  })
})
