import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { computerUseMcpServer } from '../../server/src/backend/adapters/acp/builtin-mcp.mjs'

export function runningApps(result) {
  if (result?.isError) throw new Error('Could not list running apps.')
  const apps = new Map()
  for (const block of result?.content || []) {
    if (block.type !== 'text') continue
    for (const line of block.text.split(/\r?\n/)) {
      const match = /^(.+?) -- (.+?) \[running\b.*?window=(.*)\]$/.exec(line.trim())
      if (match) apps.set(match[1], { app: match[1], label: `${match[1]} — ${match[3]}` })
    }
  }
  return [...apps.values()]
}

export function screenshotImage(result) {
  if (result?.isError) throw new Error('The selected app could not be captured. Make sure its window is open.')
  const image = result?.content?.find(block => block.type === 'image' && ['image/png', 'image/jpeg'].includes(block.mimeType))
  if (!image?.data) throw new Error('No screenshot was returned. Open the app window and try again.')
  if (image.data.length > 40 * 1024 * 1024) throw new Error('The screenshot is too large.')
  return `data:${image.mimeType};base64,${image.data}`
}

export async function callScreenTool(name, args = {}) {
  if (!['list_apps', 'get_app_state'].includes(name)) throw new Error('Unsupported screen tool.')
  const descriptor = computerUseMcpServer()
  if (!descriptor) throw new Error('The local computer-use MCP is unavailable or disabled.')
  const transport = new StdioClientTransport({
    command: descriptor.command,
    args: descriptor.args,
    env: { ...process.env, ...Object.fromEntries(descriptor.env.map(item => [item.name, item.value])) },
    stderr: 'pipe',
  })
  transport.stderr?.on('data', () => {})
  const client = new Client({ name: 'local-voice-screen-capture', version: '1.0.0' })
  try {
    await client.connect(transport, { timeout: 10_000 })
    return await client.callTool({ name, arguments: args }, undefined, { timeout: 20_000 })
  } finally {
    await client.close().catch(() => {})
    await transport.close().catch(() => {})
  }
}
