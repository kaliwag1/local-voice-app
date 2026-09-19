import { useEffect, useState } from 'react'
import { activityLabel, groupedTools } from './turn-activity.js'
import { isActive, streamLabel } from './turn-stream.js'

const number = value => value === null || value === undefined ? 'unavailable' : value.toLocaleString()

// Snapshots arrive at most twice a second, but the clock should look like a
// clock, so a running turn re-renders on its own. A settled turn does not tick.
function useTick(active, ms = 250) {
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [active, ms])
}

export default function TurnActivity({ activity }) {
  useTick(isActive(activity))
  if (!activity) return null
  const groups = groupedTools(activity.tools)
  const stream = streamLabel(activity)
  return <details className={`turn-activity turn-activity-${activity.status}`}>
    <summary>{activityLabel(activity)}{stream && <span className="turn-stream"> · {stream}</span>}</summary>
    <div className="turn-activity-body">
      {activity.message && <p>{activity.message}</p>}
      {groups.length > 0 && <ul>{groups.map(tool => <li key={tool.name}>
        <code>{tool.name}</code> × {tool.count} — {tool.running ? `${tool.running} running` : tool.failed ? `${tool.failed} failed` : 'completed'}
        {tool.count >= 3 && <span> · repeated calls</span>}
      </li>)}</ul>}
      {groups.length > 0 && <small>Tool arguments and results are hidden here. Existing permission prompts still apply.</small>}
      <p>{activity.usage
        ? `Tokens across ${activity.usage.reportedResponses} reported model response(s): prompt ${number(activity.usage.input)} · completion ${number(activity.usage.output)} · total ${number(activity.usage.total)}${activity.usage.complete ? '' : '. Some responses have no usage report.'}`
        : 'Token usage unavailable from this runtime so far.'}</p>
      {activity.stream?.characters > 0 && <p>
        Streamed {number(activity.stream.characters)} characters in {number(activity.stream.deltas)} chunks.
      </p>}
      <small>Token counts and the rate come from the runtime's own usage report, which most runtimes
        send only when a response finishes. The character count is what actually arrived; nothing here
        is estimated from the text.</small>
      {activity.reasoning ? <details className="turn-thinking"><summary>Model-provided thinking</summary>
        <pre>{activity.reasoning}</pre>{activity.reasoningTruncated && <small>Display limited to the first 24,000 characters.</small>}
      </details> : <p>Thinking unavailable: this runtime path has not supplied reasoning text.</p>}
    </div>
  </details>
}
