import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { SessionJournal } from './session-journal.mjs'
import { decodeSessionJournal } from './session-journal-format.mjs'

function pathSegment(value, fallback) {
  const text = String(value || '').trim()
  if (!text) return fallback
  // Injective and traversal-safe: unlike replacing punctuation with '_', this
  // cannot make two distinct owner/session ids share a journal directory.
  return Buffer.from(text, 'utf8').toString('base64url')
}

export async function readSessionMeta(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function readSessionMetaSync(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Owns per-owner/per-session journals without coupling them to a domain model. */
export class SessionJournalRegistry {
  constructor({ directory, logger = null } = {}) {
    if (!directory) throw new TypeError('directory is required')
    this.directory = resolve(directory)
    this.logger = logger
    this.journals = new Map()
  }

  key(ownerId, sessionId) {
    return `${String(ownerId || 'personal')}\u0000${String(sessionId || 'main')}`
  }

  get(ownerId, sessionId = 'main') {
    const key = this.key(ownerId, sessionId)
    let journal = this.journals.get(key)
    if (!journal) {
      const owner = pathSegment(ownerId, 'personal')
      const session = pathSegment(sessionId, 'main')
      journal = new SessionJournal({
        filePath: resolve(this.directory, owner, session, 'session.jsonl'),
        sessionId: String(sessionId || 'main'),
        metadata: { ownerId: String(ownerId || 'personal') },
      })
      this.journals.set(key, journal)
    }
    return journal
  }

  append({ ownerId, sessionId = 'main', event } = {}) {
    const journal = this.get(ownerId, sessionId)
    return journal.append(event).catch(error => {
      this.logger?.warn('session_journal.append_failed', {
        ownerId,
        sessionId,
        eventType: event?.type,
        error,
      })
      return null
    })
  }

  async flush() {
    await Promise.all([...this.journals.values()].map(journal => journal.flush()))
  }

  async read(ownerId, sessionId = 'main') {
    const journal = this.get(ownerId, sessionId)
    await journal.flush()
    await journal.open()
    return journal.list()
  }

  // Per-session sidecar for facts that are not conversation events (archive
  // state today). It lives beside session.jsonl so the append-only journal
  // format and its replay/validation stay untouched.
  metaPath(ownerId, sessionId = 'main') {
    return resolve(dirname(this.get(ownerId, sessionId).filePath), 'meta.json')
  }

  async readMeta(ownerId, sessionId = 'main') {
    return readSessionMeta(this.metaPath(ownerId, sessionId))
  }

  async updateMeta(ownerId, sessionId = 'main', patch = {}) {
    const path = this.metaPath(ownerId, sessionId)
    const next = { ...(await readSessionMeta(path)), ...patch, updatedAt: new Date().toISOString() }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, `${JSON.stringify(next)}\n`, { encoding: 'utf8', mode: 0o600 })
    return next
  }

  /** Whether a journal exists on disk for this owner/session pair. */
  async exists(ownerId, sessionId = 'main') {
    try {
      await readFile(this.get(ownerId, sessionId).filePath)
      return true
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
  }

  /** Permanently removes one session's journal directory and forgets it. */
  async delete(ownerId, sessionId = 'main') {
    const key = this.key(ownerId, sessionId)
    const journal = this.get(ownerId, sessionId)
    await journal.flush()
    const directory = dirname(journal.filePath)
    // Owner/session ids are base64url segments, so the directory is always
    // exactly <root>/<owner>/<session>; never remove anything shallower.
    if (resolve(directory, '..', '..') !== this.directory) {
      throw new Error('refusing to delete outside the session journal root')
    }
    this.journals.delete(key)
    await rm(directory, { recursive: true, force: true })
  }

  readAllSync() {
    return [...this.iterateSync()]
  }

  *paths(directory = this.directory, onError = (error, path) => this.logger?.warn('session_journal.scan_failed', { path, error })) {
    let entries = []
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch (error) {
      if (error.code !== 'ENOENT') onError(error, directory)
      return
    }
    for (const entry of entries) {
      const target = resolve(directory, entry.name)
      if (entry.isDirectory()) yield* this.paths(target, onError)
      else if (entry.isFile() && entry.name === 'session.jsonl') {
        yield target
      }
    }
  }

  // Startup projections consume one file at a time, rather than retaining
  // every parsed journal simultaneously. The array API remains for callers
  // that explicitly need a materialized snapshot.
  *iterateSync() {
    for (const target of this.paths()) {
      try {
        const decoded = decodeSessionJournal(readFileSync(target))
        if (decoded.discardedBytes) {
          this.logger?.warn('session_journal.torn_tail', {
            path: target,
            discardedBytes: decoded.discardedBytes,
          })
        }
        yield { path: target, records: decoded.records }
      } catch (error) {
        this.logger?.warn('session_journal.read_failed', { path: target, error })
      }
    }
  }

  taskSnapshotsSync() {
    const snapshots = new Map()
    const revisions = new Map()
    for (const journalFile of this.iterateSync()) {
      for (const event of journalFile.records || []) {
        const task = event?.payload?.task
        if (event?.type !== 'qwaudio/task/event' || !task?.id) continue
        // seq is local to a journal, not a global revision. In particular, a
        // recycled short ID must not resurrect an older task from a long log.
        const revision = [Number(task.createdAt) || 0, Date.parse(event.time) || 0, event.seq]
        const previous = revisions.get(task.id)
        const different = previous ? revision.findIndex((value, index) => value !== previous[index]) : -1
        if (!previous || (different !== -1 && revision[different] > previous[different])) {
          snapshots.set(task.id, { ...task, journalSeq: event.seq })
          revisions.set(task.id, revision)
        }
      }
    }
    return [...snapshots.values()]
  }
}
