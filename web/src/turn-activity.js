export function mergeTurnActivities(current, incoming, live = false) {
  const next = { ...current }
  for (const item of incoming || []) {
    if (!item?.turnId) continue
    const old = next[item.turnId]
    if (old && Number(old.updatedAt) > Number(item.updatedAt)) continue
    if (old && Number(old.updatedAt) === Number(item.updatedAt) && Number(old.version) > Number(item.version)) continue
    next[item.turnId] = { ...item, live: live || Boolean(old?.live) }
  }
  return Object.fromEntries(Object.entries(next).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 100))
}

export function activityLabel(activity) {
  const count = activity.tools?.length || 0
  const active = ['working', 'tools', 'waiting'].includes(activity.status)
  const labels = { working: 'Model working', tools: 'Using tools', waiting: 'Waiting for runtime', completed: 'Complete', failed: 'Response failed', interrupted: 'Interrupted', 'no-answer': 'Finished without an answer' }
  const label = activity.status === 'working' && !activity.responseCount ? 'Waiting for model' : labels[activity.status] || 'Activity'
  return `${active && !activity.live ? 'Last recorded: ' : ''}${label}${count ? ` · ${count} tool call${count === 1 ? '' : 's'}` : ''}`
}

export function groupedTools(tools = []) {
  const groups = new Map()
  for (const tool of tools) {
    const group = groups.get(tool.name) || { name: tool.name, count: 0, running: 0, failed: 0 }
    group.count++; if (tool.status === 'running') group.running++; if (tool.status === 'failed') group.failed++
    groups.set(tool.name, group)
  }
  return [...groups.values()]
}
