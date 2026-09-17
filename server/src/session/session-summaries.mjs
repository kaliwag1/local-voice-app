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
  const firstUser = replay.messages.find(message => message.role === 'user')
  const title = plainText(firstUser?.content).replace(/\s+/gu, ' ').trim().slice(0, 80)
  const lastEvent = records.at(-1)
  return {
    sessionId: replay.header.sessionId,
    title: title || 'New chat',
    createdAt: replay.header.createdAt || '',
    updatedAt: lastEvent?.time || replay.header.createdAt || '',
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
        summaries.push({ ...summary, archived: meta.archived === true })
      }
    } catch {
      // An invalid journal is ignored rather than breaking the whole list.
    }
  }
  return summaries.sort((left, right) => (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  ))
}
