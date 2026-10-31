'use client'

export function UiCheck({
  name,
  checked,
  onChange,
  label,
  hint,
}: {
  name?: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <div className="ui-check-row">
      {name ? <input type="hidden" name={name} value={checked ? '1' : '0'} /> : null}
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        className={checked ? 'ui-check checked' : 'ui-check'}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-check-box" aria-hidden="true">
          {checked ? '✓' : ''}
        </span>
        <span>{label}</span>
      </button>
      {hint ? <span className="ui-check-hint">{hint}</span> : null}
    </div>
  )
}
