import { LIGHT_PRESETS } from '../shared/lights'
import { useGm } from './store'

/** Banner shown while a light is waiting to be placed. */
export function PlacementHint() {
  const kind = useGm((s) => s.placingLight)
  if (!kind) return null
  const { icon, label } = LIGHT_PRESETS[kind]
  return (
    <div className="placement-hint" role="status">
      {icon} Click the map to place the {label.toLowerCase()} · <kbd>Shift</kbd>-click to place more ·{' '}
      <kbd>Esc</kbd> or right-click to cancel
    </div>
  )
}
