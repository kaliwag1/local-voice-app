import { dirname, resolve } from 'node:path'
import { replaySession } from './session-replay.mjs'
import { readSessionMetaSync } from './session-journal-registry.mjs'

function plainText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(plainText).filter(Boolean).join(' ')
  if (content && typeof content === 'object') {
    return plainText(content.text || content.content || content.transcript || '')
  }
  return ''
}

export function sessionSummary(records, ownerId) {
  const replay = replaySession(records)
  if (replay.header.ownerId !== ownerId) return null
  const firstUserIndex = replay.messages.findIndex(message => message.role === 'user')
  const firstUser = replay.messages[firstUserIndex]
  const hasAssistantReply = firstUserIndex >= 0 && replay.messages
    .slice(firstUserIndex + 1).some(message => message.role === 'assistant')
  const title = plainText(firstUser?.content).replace(/\s+/gu, ' ').trim().slice(0, 80)
  const lastEvent = records.at(-1)
  return {
    sessionId: replay.header.sessionId,
    title: title || 'New chat',
    titleSource: 'derived',
    hasAssistantReply,
    createdAt: replay.header.createdAt || '',
    updatedAt: lastEvent?.time || replay.header.createdAt || '',
  }
}

// Apply the per-session sidecar (user rename, auto title, pin, archive) on
// top of the derived summary. A user-typed title always wins.
export function applySessionMeta(summary, meta = {}) {
  const custom = String(meta.title || '').trim()
  return {
    ...summary,
    ...(custom
      ? { title: custom, titleSource: meta.titleSource === 'auto' ? 'auto' : 'custom' }
      : {}),
    archived: meta.archived === true,
    pinned: meta.pinned === true,
  }
}

export async function listSessionSummaries(journal, ownerId) {
  await journal.flush?.()
  const read = journal.iterateSync || journal.readAllSync
  if (typeof read !== 'function') return []
  const summaries = []
  for (const entry of read.call(journal)) {
    try {
      const summary = sessionSummary(entry.records, ownerId)
      if (summary) {
        const meta = entry.path ? readSessionMetaSync(resolve(dirname(entry.path), 'meta.json')) : {}
        summaries.push(applySessionMeta(summary, meta))
      }
    } catch {
      // An invalid journal is ignored rather than breaking the whole list.
    }
  }
  return summaries.sort((left, right) => (
    Number(right.pinned) - Number(left.pinned)
    || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  ))
}
