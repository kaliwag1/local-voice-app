// Where the bundled computer-use MCP server lives and how to launch it.
// Shared because both the Gateway (which hands it to backend Agents) and the
// desktop app (which calls it directly for screen capture) need the same
// answer, and the desktop must not import Gateway internals.
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { findExecutable } from './setup.mjs'

const require = createRequire(import.meta.url)

export function settingEnabled(value, fallback = true) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  return !['false', 'off', '0', 'no', 'disabled'].includes(normalized)
}

// Inside Electron, require.resolve returns paths within the asar archive.
// Backend Agents are external processes that cannot read archived files, so
// point them at the asarUnpack mirror instead.
function externallyReadable(path) {
  return path.replace(
    `${sep}app.asar${sep}`,
    `${sep}app.asar.unpacked${sep}`,
  )
}

function resolvePackageBin(specifier, binName) {
  try {
    const packagePath = require.resolve(`${specifier}/package.json`)
    const manifest = require(`${specifier}/package.json`)
    const relative = typeof manifest.bin === 'string'
      ? manifest.bin
      : manifest.bin?.[binName]
    if (!relative) return null
    const binPath = externallyReadable(join(dirname(packagePath), relative))
    return existsSync(binPath) ? binPath : null
  } catch {
    return null
  }
}

// The backend Agent spawns this server itself, outside the Gateway's control
// of window creation. On Windows, Electron running as Node allocates a
// visible console when it is started without one, which surfaces as a blank
// terminal window every time the backend connects. A real Node binary does
// not, so prefer one from PATH there; the Electron fallback keeps working
// where Node is not installed.
export function computerUseRuntime({
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
  find = findExecutable,
} = {}) {
  if (platform === 'win32' && !env.QWEN_AUDIO_AGENT_NODE_BIN_DISABLED) {
    const explicit = String(env.QWEN_AUDIO_AGENT_NODE_BIN || '').trim()
    const node = explicit || find('node', { env, platform })
    if (node) return { command: node, env: [] }
  }
  // The bin is a Node script; when the Gateway runs inside Electron the
  // backend inherits execPath, so force plain Node semantics.
  return { command: execPath, env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] }
}

export function computerUseMcpServer(env = process.env, runtimeOptions = {}) {
  if (!settingEnabled(env.QWEN_AUDIO_AGENT_COMPUTER_USE)) return null
  const binPath = resolvePackageBin(
    '@qwen-code/open-computer-use',
    'open-computer-use',
  )
  if (!binPath) return null
  const runtime = computerUseRuntime({ env, ...runtimeOptions })
  const descriptor = {
    name: 'open-computer-use',
    type: 'stdio',
    command: runtime.command,
    args: [binPath, 'mcp'],
    env: runtime.env,
  }
  return descriptor
}

