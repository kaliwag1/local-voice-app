import { useDismissOnOutside } from '../use-dismiss.js'

// The model in use, named in the controls row, and a click away from changing.
// Switching is the existing sidebar action: it unloads and reloads a local
// model, so this stays disabled while one is in flight rather than queueing a
// second switch, and it says what is happening instead of looking inert.
export default function ComposerModelPicker({
  models = [],
  value = '',
  busy = false,
  progress = '',
  warning = '',
  error = '',
  onChange = () => {},
  onRefresh = null,
}) {
  const ref = useDismissOnOutside()
  const current = models.find(model => model.modelKey === value)
  const label = busy && progress ? progress : current?.displayName || value || 'No model'
  if (!models.length && !value) return null
  return <details ref={ref} className={`composer-model${busy ? ' busy' : ''}`}>
    <summary
      aria-label={`Model: ${label}. Open to switch.`}
      title={busy ? progress || 'Switching model…' : 'Switch model'}
    >{label}</summary>
    <div className="composer-model-body">
      {busy && <p className="composer-model-note">{progress || 'Switching model…'}</p>}
      {error && <p className="composer-model-note error" role="alert">{error}</p>}
      {warning && <p className="composer-model-note">{warning}</p>}
      <ul>
        {models.map(model => <li key={model.modelKey}>
          <button
            type="button"
            className={model.modelKey === value ? 'current' : ''}
            disabled={busy || model.modelKey === value}
            onClick={event => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              void onChange(model.modelKey)
            }}
          >{model.displayName}{model.modelKey === value ? ' ·' : ''}</button>
        </li>)}
      </ul>
      {!models.length && <p className="composer-model-note">No local models are available.</p>}
      {onRefresh && <button
        type="button"
        className="composer-model-refresh"
        disabled={busy}
        onClick={() => { void onRefresh() }}
      >Refresh downloaded models</button>}
    </div>
  </details>
}
