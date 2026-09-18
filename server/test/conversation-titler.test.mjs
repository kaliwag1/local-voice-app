import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionJournalRegistry } from '../src/session/session-journal-registry.mjs'
import { listSessionSummaries } from '../src/session/session-summaries.mjs'
import {
  ConversationTitler,
  createLocalTitleModelCall,
  sanitizeTitle,
} from '../src/session/conversation-titler.mjs'

async function withConversation(run) {
  const directory = await mkdtemp(join(tmpdir(), 'qwaudio-titles-'))
  try {
    const journal = new SessionJournalRegistry({ directory })
    await journal.append({ ownerId: 'me', sessionId: 'first', event: {
      type: 'user/message', payload: { messageId: 'u', content: 'Help me plan a shoot' },
    } })
    await journal.append({ ownerId: 'me', sessionId: 'first', event: {
      type: 'assistant/message', payload: { messageId: 'a', content: 'Let us make a shot list.' },
    } })
    await journal.flush()
    await run(journal)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('generates a title after an exchange and preserves a later manual rename', async () => {
  await withConversation(async journal => {
    const calls = []
    const titler = new ConversationTitler({ journal, llmCall: async prompt => {
      calls.push(prompt)
      return 'Shoot planning'
    } })
    let sessions = await listSessionSummaries(journal, 'me')
    assert.equal(sessions[0].hasAssistantReply, true)
    assert.equal(titler.schedule('me', sessions), 1)
    assert.equal(titler.schedule('me', sessions), 0)
    for (let attempt = 0; attempt < 50; attempt += 1) {
      sessions = await listSessionSummaries(journal, 'me')
      if (sessions[0].titleSource === 'auto') break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.equal(sessions[0].title, 'Shoot planning')
    assert.equal(sessions[0].titleSource, 'auto')
    assert.match(calls[0].user, /Help me plan a shoot/u)
    await journal.updateMeta('me', 'first', { title: 'My shoot', titleSource: 'custom' })
    sessions = await listSessionSummaries(journal, 'me')
    assert.equal(sessions[0].title, 'My shoot')
    assert.equal(titler.schedule('me', sessions), 0)
  })
})

test('pinning moves a chat above newer unpinned chats', async () => {
  await withConversation(async journal => {
    await journal.append({ ownerId: 'me', sessionId: 'second', event: {
      type: 'user/message', payload: { messageId: 'u2', content: 'Newer chat' },
    } })
    await journal.flush()
    await journal.updateMeta('me', 'first', { pinned: true })
    const sessions = await listSessionSummaries(journal, 'me')
    assert.equal(sessions[0].sessionId, 'first')
    assert.equal(sessions[0].pinned, true)
  })
})

test('title calls remain on loopback and use the selected local model', async () => {
  assert.throws(() => createLocalTitleModelCall({ baseUrl: 'https://example.com/v1' }), /local/u)
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Local title' } }] }) }
  }
  const call = createLocalTitleModelCall({
    baseUrl: 'http://127.0.0.1:1234/v1',
    selectionFile: 'selected',
    readFileImpl: async () => 'google/gemma-4-26b-a4b-qat',
    fetchImpl,
  })
  assert.equal(await call({ system: 'title', user: 'conversation' }), 'Local title')
  assert.equal(calls[0].url, 'http://127.0.0.1:1234/v1/chat/completions')
  assert.equal(JSON.parse(calls[0].options.body).model, 'google/gemma-4-26b-a4b-qat')
  assert.equal(sanitizeTitle('Title: A brief chat\nExplanation'), 'A brief chat')
})

test('Bonsai titles use the Prism endpoint and serving alias', async () => {
  let request
  const call = createLocalTitleModelCall({ selectionFile: 'selection', readFileImpl: async () => 'bonsai/crack',
    fetchImpl: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({ choices: [] }) } } })
  await call({ system: 'title', user: 'hello' })
  assert.equal(request.url, 'http://127.0.0.1:8080/v1/chat/completions')
  assert.equal(request.body.model, 'bonsai')
})
