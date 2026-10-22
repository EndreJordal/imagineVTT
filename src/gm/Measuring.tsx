import { MEASURE_COLORS, type MeasureDistance, type MeasureSnap } from '../shared/measure'
import { useGm } from './store'
import { Section } from './ui'

const SNAPS: { value: MeasureSnap; label: string; title: string }[] = [
  { value: 'line', label: 'Grid line', title: 'Lines and circles snap to grid corners' },
  { value: 'center', label: 'Grid center', title: 'Lines and circles snap to the middle of squares' },
]
const DISTANCES: { value: MeasureDistance; label: string; title: string }[] = [
  { value: 'real', label: 'Real distance', title: 'Lines show the straight-line distance, in squares (yards)' },
  { value: 'grid', label: 'Grid traverse', title: 'Lines show squares crossed, as for movement: diagonals count 1 (circles always measure the real radius)' },
]

/** Sidebar section: how measuring looks and measures, and clearing what's kept. */
export function MeasuringSection() {
  const measure = useGm((s) => s.measure)
  const kept = useGm((s) => s.scene.measures?.length ?? 0)
  const { setMeasure, clearMeasures } = useGm.getState()
  return (
    <Section id="measuring" title="Measuring">
      <label className="check" title="Measurements stay on the map after you let go (else only while the button is held)">
        <input type="checkbox" checked={measure.persist} onChange={(e) => setMeasure({ persist: e.target.checked })} />
        Persist measuring
      </label>
      <button disabled={!kept} onClick={clearMeasures} title="Remove every kept measurement and drawing on this floor (undo brings them back)">
        Clear all measuring{kept ? ` (${kept})` : ''}
      </button>

      <span className="slider-label">Measuring color</span>
      <div className="measure-colors">
        {MEASURE_COLORS.map((c) => (
          <button
            key={c.color}
            className={`measure-color${measure.color.toLowerCase() === c.color ? ' active' : ''}`}
            style={{ background: c.color }}
            title={c.name}
            aria-label={c.name}
            aria-pressed={measure.color.toLowerCase() === c.color}
            onClick={() => setMeasure({ color: c.color })}
          />
        ))}
        <input
          type="color"
          className="swatch"
          title="Any colour"
          value={measure.color}
          onChange={(e) => setMeasure({ color: e.target.value })}
        />
      </div>

      <span className="slider-label">Snap from</span>
      <div className="segmented" role="radiogroup" aria-label="Snap from">
        {SNAPS.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={measure.snap === o.value}
            className={measure.snap === o.value ? 'active' : ''}
            title={o.title}
            onClick={() => setMeasure({ snap: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <span className="slider-label">Display distance</span>
      <div className="segmented" role="radiogroup" aria-label="Display distance">
        {DISTANCES.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={measure.distance === o.value}
            className={measure.distance === o.value ? 'active' : ''}
            title={o.title}
            onClick={() => setMeasure({ distance: o.value })}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="hint">Measure with the ruler tool (M). Alt: no snapping. Right-click a measurement to remove it.</p>
    </Section>
  )
}
