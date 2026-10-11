import type { Orientation } from '../shared/types'
import { useGm } from './store'

/**
 * Four buttons, one per table orientation. Each draws the PVB as it appears on the GM map,
 * with the yellow triangle on the edge that is "up" on the table (see upMarker's test).
 */
const OPTIONS: { orientation: Orientation; label: string }[] = [
  { orientation: 0, label: 'Table top is the top of the map' },
  { orientation: 90, label: 'Table top is the left of the map' },
  { orientation: 180, label: 'Table top is the bottom of the map' },
  { orientation: 270, label: 'Table top is the right of the map' },
]

export function PvbOrientation() {
  const orientation = useGm((s) => s.display.orientation)
  const setDisplay = useGm((s) => s.setDisplay)
  return (
    <div className="row pvb-orientation" role="radiogroup" aria-label="PVB orientation">
      {OPTIONS.map((o) => (
        <button
          key={o.orientation}
          role="radio"
          aria-checked={orientation === o.orientation}
          aria-label={o.label}
          title={o.label}
          className={orientation === o.orientation ? 'active' : ''}
          onClick={() => setDisplay({ orientation: o.orientation })}
        >
          <PvbIcon orientation={o.orientation} />
        </button>
      ))}
    </div>
  )
}

/**
 * A landscape box (the TV) with the triangle on its top edge, pointing in. Rotating it by
 * the orientation puts the triangle where the GM map shows it: the table rotates the map
 * clockwise, so on the map its top edge turns the other way.
 */
function PvbIcon({ orientation }: { orientation: Orientation }) {
  return (
    <svg width="26" height="26" viewBox="-13 -13 26 26" aria-hidden>
      <g transform={`rotate(${-orientation})`}>
        <rect x="-10" y="-7" width="20" height="14" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M -4 -7 L 4 -7 L 0 -1.5 Z" fill="#ffb020" />
      </g>
    </svg>
  )
}
