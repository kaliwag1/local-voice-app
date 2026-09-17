// Persistent "always allow" rules for agent permission requests.
//
// A rule matches either a command line (glob, e.g. `ffprobe *`) or a folder
// (prefix, e.g. `D:\Footage`, read-only or read/write). Matching rules make the
// Gateway approve the request without asking. A short list of destructive
// commands and every `delete` tool call stay gated whatever the rules say.
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  READ_KINDS,
  WRITE_KINDS,
  isDangerousCommand,
  operationPaths,
  suggestRule,
} from '../core/permission-rule-patterns.mjs'

export { isDangerousCommand, suggestRule }

export const RULE_TYPES = Object.freeze(['command', 'path'])
export const PATH_ACCESS = Object.freeze(['read', 'write'])
const MAX_RULES = 200

// Folder roots that are too broad to auto-allow (drives, Windows, Program
// Files, the Users folder and any profile root, and their POSIX cousins).
function isProtectedRoot(path) {
  const normalized = normalizePath(path)
  return [
    /^[a-z]:$/, /^[a-z]:\\windows$/, /^[a-z]:\\program files( \(x86\))?$/,
    /^[a-z]:\\users$/, /^[a-z]:\\users\\[^\\]+$/,
    /^$/, /^\\(etc|usr|bin|sbin|system|home|root|var)$/, /^\\home\\[^\\]+$/,
  ].some(pattern => pattern.test(normalized))
}

function clean(value, max = 600) {
  return String(value ?? '').replaceAll('\u0000', '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizePath(value) {
  return clean(value, 600).replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()
}

function globToRegExp(pattern) {
  const source = pattern.split(/(\*|\?)/).map(part => {
    if (part === '*') return '.*'
    if (part === '?') return '.'
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('')
  return new RegExp(`^${source}$`, 'is')
}

// Validate and normalise user input for a rule; throws with a user-facing
// message. Returns the fields a stored rule carries (without id/timestamps).
export function validateRule(input = {}) {
  const type = clean(input.type, 20)
  const note = clean(input.note, 200)
  if (type === 'command') {
    const pattern = clean(input.pattern, 300)
    if (!pattern) throw new Error('Enter a command pattern such as "ffprobe *".')
    const [first] = pattern.split(' ')
    if (/[*?]/.test(first)) {
      throw new Error('The command name itself must be spelled out ("ffprobe *", not "* -i *").')
    }
    if (first.length < 2) throw new Error('Enter a command pattern such as "ffprobe *".')
    if (isDangerousCommand(pattern) || isDangerousCommand(first)) {
      throw new Error(`"${first}" is on the always-ask list (destructive or privileged commands are never auto-allowed).`)
    }
    return { type, pattern, note }
  }
  if (type === 'path') {
    const raw = clean(input.pattern, 600).replaceAll('/', '\\').replace(/\\+$/, '')
    if (isProtectedRoot(raw)) {
      throw new Error('Whole drives, Windows, Program Files and user-profile roots cannot be auto-allowed. Pick a folder inside them.')
    }
    if (!/^([a-z]:\\|\\\\[^\\]+\\[^\\]+|\\[^\\])/i.test(raw)) {
      throw new Error('Enter a full folder path such as "D:\\Footage".')
    }
    const access = PATH_ACCESS.includes(input.access) ? input.access : 'read'
    return { type, pattern: raw, access, note }
  }
  throw new Error('Rule type must be "command" or "path".')
}

function pathUnder(candidate, root) {
  const normalized = normalizePath(candidate)
  const base = normalizePath(root)
  return normalized === base || normalized.startsWith(`${base}\\`)
}

// Decide for one operation. Returns { rule } on a match, { blocked: reason }
// when the operation must always ask, or null when no rule applies.
export function matchRules(rules, operation) {
  if (!operation || typeof operation !== 'object') return null
  const kind = clean(operation.kind, 80).toLowerCase()
  const command = clean(operation.command, 1200)
  if (kind === 'delete') return { blocked: 'delete operations always ask' }
  if (command) {
    if (isDangerousCommand(command)) return { blocked: 'command is on the always-ask list' }
    const rule = rules.find(candidate => candidate.type === 'command' && globToRegExp(candidate.pattern).test(command))
    return rule ? { rule } : null
  }
  const paths = operationPaths(operation)
  if (!paths.length) return null
  const rule = rules.find(candidate => {
    if (candidate.type !== 'path') return false
    const allowedKinds = candidate.access === 'write' ? WRITE_KINDS : READ_KINDS
    if (!allowedKinds.has(kind)) return false
    return paths.every(path => pathUnder(path, candidate.pattern))
  })
  return rule ? { rule } : null
}

export class PermissionRules {
  constructor({ path, logger = null, now = () => Date.now() } = {}) {
    this.path = path
    this.logger = logger
    this.now = now
    this.rules = []
    this.writing = Promise.resolve()
    if (path) this.loadSync()
  }

  loadSync() {
    try {
      const raw = readFileSync(this.path, 'utf8').replace(/^\uFEFF/, '')
      const parsed = JSON.parse(raw)
      const rules = Array.isArray(parsed?.rules) ? parsed.rules : []
      this.rules = rules.flatMap(rule => {
        try {
          const fields = validateRule(rule)
          return [{
            id: clean(rule.id, 60) || this.newId(),
            ...fields,
            createdAt: Number(rule.createdAt) || this.now(),
            lastUsedAt: Number(rule.lastUsedAt) || null,
            useCount: Number.isInteger(rule.useCount) ? rule.useCount : 0,
          }]
        } catch (error) {
          this.logger?.warn?.('permission_rules.dropped_invalid', { rule, error: error.message })
          return []
        }
      })
    } catch (error) {
      if (error.code !== 'ENOENT') this.logger?.warn?.('permission_rules.load_failed', { error: error.message })
      this.rules = []
    }
  }

  newId() {
    return `rule_${randomBytes(6).toString('base64url')}`
  }

  list() {
    return this.rules.map(rule => ({ ...rule }))
  }

  add(input) {
    const fields = validateRule(input)
    const duplicate = this.rules.find(rule => rule.type === fields.type
      && rule.pattern.toLowerCase() === fields.pattern.toLowerCase()
      && (rule.type !== 'path' || rule.access === fields.access))
    if (duplicate) return { ...duplicate }
    if (this.rules.length >= MAX_RULES) throw new Error(`At most ${MAX_RULES} rules can be stored.`)
    const rule = { id: this.newId(), ...fields, createdAt: this.now(), lastUsedAt: null, useCount: 0 }
    this.rules.push(rule)
    this.persist()
    return { ...rule }
  }

  remove(id) {
    const index = this.rules.findIndex(rule => rule.id === clean(id, 60))
    if (index === -1) return false
    this.rules.splice(index, 1)
    this.persist()
    return true
  }

  // Returns the matching rule (and records the use) or null. `blocked`
  // outcomes are surfaced through `explain` for the UI, never auto-allowed.
  match(operation) {
    const outcome = matchRules(this.rules, operation)
    if (!outcome?.rule) return null
    outcome.rule.lastUsedAt = this.now()
    outcome.rule.useCount += 1
    this.persist()
    return { ...outcome.rule }
  }

  explain(operation) {
    return matchRules(this.rules, operation)
  }

  persist() {
    if (!this.path) return this.writing
    const content = `${JSON.stringify({ version: 1, rules: this.rules }, null, 2)}\n`
    this.writing = this.writing.then(async () => {
      mkdirSync(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${process.pid}.tmp`
      await writeFile(temporary, content, 'utf8')
      try { await rename(temporary, this.path) } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    }).catch(error => {
      this.logger?.warn?.('permission_rules.save_failed', { error: error.message })
    })
    return this.writing
  }

  async flush() {
    await this.writing
  }
}
