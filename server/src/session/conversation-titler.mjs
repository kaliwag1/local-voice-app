// Gives saved chats a short title once they have a real exchange, using the
// local chat model (LM Studio's OpenAI-compatible server). It never overrides
// a title the user typed and runs in the background. Failed calls have a
// cooldown and a small retry limit so LM Studio startup is not fatal.
import { readFile } from 'node:fs/promises'
import { replaySession } from './session-replay.mjs'
import { isBonsai, localModelRoute } from '../../../shared/local-model-route.mjs'

const MAX_TITLE = 60
const MAX_CONTEXT = 1200

function clean(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim()
}

export function plainText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(plainText).filter(Boolean).join(' ')
  if (content && typeof content === 'object') {
    return plainText(content.text || content.content || content.transcript || '')
  }
  return ''
}

export function sanitizeTitle(value) {
  let title = String(value || '').split(/\r?\n/u)[0]
    .replace(/^(title|chat title|标题)\s*[:：]\s*/iu, '')
    .replace(/^["'“”‘’`*_#\s]+|["'“”‘’`*_#\s.]+$/gu, '')
  title = clean(title)
  if (title.length > MAX_TITLE) title = `${title.slice(0, MAX_TITLE - 1).trimEnd()}…`
  return title
}

// Resolve the model to ask. Preference order: the model the launcher/switcher
// selected (.selected-voice-model), the model LM Studio reports as loaded,
// the first model the server lists. Never triggers a load of a new model.
export async function resolveLocalModel({
  baseUrl,
  selectionFile = '',
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
} = {}) {
  if (selectionFile) {
    try {
      const selected = clean(await readFileImpl(selectionFile, 'utf8'))
      if (selected) return selected
    } catch { /* fall through */ }
  }
  const origin = new URL(baseUrl).origin
  try {
    const response = await fetchImpl(`${origin}/api/v0/models`)
    if (response.ok) {
      const payload = await response.json()
      const loaded = (payload?.data || []).find(item => item?.state === 'loaded' && item?.type === 'llm')
      if (loaded?.id) return loaded.id
    }
  } catch { /* LM Studio-specific endpoint; ignore */ }
  try {
    const response = await fetchImpl(`${baseUrl}/models`)
    if (response.ok) {
      const payload = await response.json()
      const first = (payload?.data || [])[0]
      if (first?.id) return first.id
    }
  } catch { /* ignore */ }
  return ''
}

export function createLocalTitleModelCall({
  baseUrl = 'http://127.0.0.1:1234/v1',
  selectionFile = '',
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
  timeoutMs = 20_000,
} = {}) {
  const base = String(baseUrl).replace(/\/+$/u, '')
  const url = new URL(base)
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('chat titles require a local LM Studio URL')
  }
  return async ({ system, user }) => {
    const selected = await resolveLocalModel({ baseUrl: base, selectionFile, fetchImpl, readFileImpl })
    const route = isBonsai(selected) ? localModelRoute(selected) : { model: selected, baseUrl: base }
    const model = route.model
    if (!model) throw new Error('no local model available')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      // LM Studio's local server does not require credentials.
      const response = await fetchImpl(`${route.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.2,
          max_tokens: 40,
          stream: false,
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`local model returned HTTP ${response.status}`)
      const payload = await response.json()
      return String(payload?.choices?.[0]?.message?.content || '')
    } finally {
      clearTimeout(timer)
    }
  }
}

export function titlePrompt(exchange) {
  return {
    system: 'You name chat conversations. Reply with only a title of 2 to 6 words in the '
      + 'language of the conversation. No quotes, no punctuation at the end, no explanation.',
    user: `Conversation:\n${exchange}\n\nTitle:`,
  }
}

export function firstExchange(records) {
  const replay = replaySession(records)
  const userIndex = replay.messages.findIndex(message => message.role === 'user')
  const user = replay.messages[userIndex]
  const assistant = replay.messages.slice(userIndex + 1).find(message => message.role === 'assistant')
  if (!user || !assistant) return ''
  return [
    `User: ${clean(plainText(user.content)).slice(0, MAX_CONTEXT)}`,
    `Assistant: ${clean(plainText(assistant.content)).slice(0, MAX_CONTEXT)}`,
  ].join('\n')
}

export class ConversationTitler {
  constructor({ journal, llmCall, logger = null, maxConcurrent = 2, retryAfterMs = 30_000 } = {}) {
    this.journal = journal
    this.llmCall = llmCall
    this.logger = logger
    this.maxConcurrent = maxConcurrent
    this.retryAfterMs = retryAfterMs
    this.attempted = new Map()
    this.inFlight = new Set()
  }

  get enabled() {
    return typeof this.llmCall === 'function'
  }

  // Called with the current summaries; picks the ones still lacking a title
  // and titles them in the background. Returns the number of jobs started.
  schedule(ownerId, summaries) {
    if (!this.enabled) return 0
    let started = 0
    for (const summary of summaries) {
      if (summary.titleSource !== 'derived' || !summary.hasAssistantReply) continue
      const key = `${ownerId}|${summary.sessionId}`
      const attempt = this.attempted.get(key)
      if (this.inFlight.has(key) || this.inFlight.size >= this.maxConcurrent
        || (attempt && (attempt.count >= 3 || Date.now() - attempt.time < this.retryAfterMs))) continue
      this.attempted.set(key, { count: (attempt?.count || 0) + 1, time: Date.now() })
      this.inFlight.add(key)
      started += 1
      this.title(ownerId, summary.sessionId)
        .then(title => {
          if (title) this.attempted.set(key, { count: 3, time: Date.now() })
        })
        .catch(error => this.logger?.warn('conversation_title.failed', { sessionId: summary.sessionId, error }))
        .finally(() => this.inFlight.delete(key))
    }
    return started
  }

  async title(ownerId, sessionId) {
    const meta = await this.journal.readMeta(ownerId, sessionId)
    if (clean(meta.title)) return null
    const records = await this.journal.read(ownerId, sessionId)
    const exchange = firstExchange(records)
    if (!exchange) return null
    const title = sanitizeTitle(await this.llmCall(titlePrompt(exchange)))
    if (!title) return null
    // Re-check: the user may have renamed the chat while the model was thinking.
    const latest = await this.journal.readMeta(ownerId, sessionId)
    if (clean(latest.title)) return null
    await this.journal.updateMeta(ownerId, sessionId, { title, titleSource: 'auto' })
    this.logger?.info('conversation_title.set', { sessionId, title })
    return title
  }
}
