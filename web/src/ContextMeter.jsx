import { contextUsage, formatContextLength, formatTokens, usageTone } from './context-usage.js'
import { useDismissOnOutside } from './use-dismiss.js'

const SIZE = 18
const RADIUS = 7
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function Ring({ ratio, tone }) {
  // A ring rather than a bar so it sits in the controls row without taking
  // width from it. Starts at twelve o'clock and fills clockwise.
  const filled = ratio === null ? 0 : CIRCUMFERENCE * ratio
  return <svg className={`context-ring context-ring-${tone}`} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
    <circle className="context-ring-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth="2.5" />
    {ratio !== null && <circle
      className="context-ring-fill"
      cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth="2.5"
      strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
      strokeDashoffset={CIRCUMFERENCE / 4}
      strokeLinecap="round"
    />}
  </svg>
}

export default function ContextMeter({
  activities,
  contextLength,
  contextOptions = [],
  contextBusy = false,
  onContextChange = null,
}) {
  const ref = useDismissOnOutside()
  const usage = contextUsage(activities, contextLength)
  const tone = usageTone(usage)
  // The ring alone carries the glance; the words are one click away. The label
  // still reaches screen readers and the tooltip, which read nothing from a
  // shape on its own.
  const label = !usage.available
    ? 'Context unmeasured'
    : usage.percent === null
      ? `${formatTokens(usage.used)} tokens used`
      : `${usage.percent}% of context used`
  return <details ref={ref} className={`context-meter context-meter-${tone}`}>
    <summary aria-label={`${label}. Open for details.`} title={label}>
      <Ring ratio={usage.available ? usage.ratio : null} tone={tone} />
    </summary>
    <div className="context-meter-body">
      {usage.available
        ? <>
          <p className="context-meter-headline">
            {usage.percent === null ? formatTokens(usage.used) : `${usage.percent}%`}
            <span> {usage.percent === null ? 'tokens used' : 'of context used'}</span>
          </p>
          <p>
            <b>{formatTokens(usage.used)}</b> tokens in the last measured request
            {usage.limit ? <> of a <b>{formatTokens(usage.limit)}</b> window</> : null}
            {usage.remaining !== null ? <> · <b>{formatTokens(usage.remaining)}</b> left</> : null}
          </p>
          <p>Prompt {formatTokens(usage.input)} · answer {formatTokens(usage.output)}.</p>
          {usage.over && <p className="context-meter-warning">
            This conversation is larger than the current window. The runtime will be dropping
            the oldest part of it. Start a new chat, or pick a larger context size in Settings.
          </p>}
          <small>
            Measured from the newest model response, so it does not include anything said or
            typed since. It is what the model was sent, not an estimate.
          </small>
        </>
        : <>
          <p className="context-meter-headline">No context reading yet</p>
          <small>
            This fills in once the runtime reports token usage for a response. Some providers
            never report it, and nothing here is guessed from the text.
          </small>
        </>}
      {onContextChange && contextOptions.length > 0 && <div className="context-meter-sizes">
        <p className="context-meter-sizes-label">Context window</p>
        <div className="context-meter-size-row">
          {contextOptions.map(option => <button
            key={option}
            type="button"
            className={Number(option) === Number(contextLength) ? 'current' : ''}
            disabled={contextBusy || Number(option) === Number(contextLength)}
            onClick={() => { void onContextChange(option) }}
          >{formatContextLength(option).replace(' tokens', '')}</button>)}
        </div>
        <small>{contextBusy
          ? 'Switching…'
          : 'Changing this reloads the model with the new window, which takes a moment.'}</small>
      </div>}
      {usage.limit ? null : <small> The context window size is unknown, so only the token count is shown.</small>}
    </div>
  </details>
}
