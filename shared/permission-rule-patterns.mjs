// Shapes shared by the Gateway's permission-rule store and the web UI's
// "Always allow…" editor: which commands are never auto-allowed, which tool
// kinds count as reads/writes, and a first-draft rule for an operation.

function clean(value, max = 600) {
  return String(value ?? '').replaceAll('\u0000', '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export const READ_KINDS = new Set(['read', 'search', 'fetch'])
export const WRITE_KINDS = new Set(['read', 'search', 'fetch', 'edit', 'move'])

// Never auto-allowed, whatever rule matches. Deliberately blunt: a false
// positive costs one click, a false negative can cost a drive.
export const DANGEROUS_COMMAND = new RegExp(String.raw`(^|[\s;&|(])(` + [
  'rm', 'rmdir', 'rd', 'del', 'erase', 'format', 'diskpart', 'mkfs(\\.\\w+)?', 'dd',
  'remove-item', 'ri', 'rm\\.exe', 'clear-content', 'remove-itemproperty',
  'shutdown', 'restart-computer', 'stop-computer', 'logoff',
  'reg(\\.exe)?\\s+delete', 'bcdedit', 'cipher\\s+/w', 'takeown', 'icacls',
  'net\\s+user', 'schtasks', 'sudo', 'runas',
  'git\\s+push\\s+.*--force', 'git\\s+reset\\s+--hard', 'git\\s+clean',
].join('|') + String.raw`)(\s|$)`, 'i')
export function isDangerousCommand(command) {
  return DANGEROUS_COMMAND.test(clean(command, 1200))
}

export function operationPaths(operation) {
  const paths = []
  if (operation?.path) paths.push(operation.path)
  for (const location of operation?.locations || []) if (location?.path) paths.push(location.path)
  return paths
}

// A sensible first draft of a rule for an operation the user just saw, for
// the "Always allow…" button to prefill.
export function suggestRule(operation) {
  if (!operation || typeof operation !== 'object') return null
  const kind = clean(operation.kind, 80).toLowerCase()
  const command = clean(operation.command, 1200)
  if (kind === 'delete') return null
  if (command) {
    if (isDangerousCommand(command)) return null
    const tokens = command.split(' ')
    const first = tokens[0]
    // Keep a subcommand for the usual "tool verb ..." shapes (git status, npm run).
    const second = tokens[1] && /^[a-z][\w-]*$/i.test(tokens[1]) && !tokens[1].startsWith('-') && /^(git|npm|npx|pnpm|yarn|dotnet|python|py|node|cargo|docker|lms|opencode)$/i.test(first)
      ? ` ${tokens[1]}` : ''
    return { type: 'command', pattern: `${first}${second} *` }
  }
  const [first] = operationPaths(operation)
  if (!first) return null
  const normalized = first.replaceAll('/', '\\')
  const parent = normalized.includes('\\') ? normalized.slice(0, normalized.lastIndexOf('\\')) : normalized
  return { type: 'path', pattern: parent, access: WRITE_KINDS.has(kind) && !READ_KINDS.has(kind) ? 'write' : 'read' }
}

