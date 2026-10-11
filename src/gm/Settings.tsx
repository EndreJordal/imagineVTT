import { useState } from 'react'
import { CALIBRATION_MM } from '../shared/geometry'
import { positive, round } from './numbers'
import { Field } from './ui'
import { useGm } from './store'
import { useDropdown } from './useDropdown'

/** Toolbar ⚙ button: settings that rarely change (calibration, for now). */
export function SettingsMenu() {
  const { open, setOpen, root } = useDropdown()
  const s = useGm()
  return (
    <div className="menu" ref={root}>
      <button
        className={`icon-button settings-button${open ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Settings"
        onClick={() => setOpen(!open)}
      >
        ⚙
      </button>
      {open && (
        <div className="menu-list menu-right settings-panel" role="dialog" aria-label="Settings">
          <h2>Table calibration</h2>
          <p className="hint">
            Show the square on the table, measure its marked edge with a ruler, and enter what you measured.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={s.calibrating}
              onChange={(e) => s.setCalibrating(e.target.checked)}
            />
            Show calibration square on table
          </label>
          <Calibrate />
          <Field label="Pixels per mm">
            <input
              type="number"
              step={0.01}
              min={0.5}
              value={round(s.display.pxPerMm, 3)}
              onChange={(e) => positive(e.target.valueAsNumber, (pxPerMm) => s.setDisplay({ pxPerMm }))}
            />
          </Field>
        </div>
      )}
    </div>
  )
}

/** Measure the on-table square with a ruler and enter the result to correct the scale. */
function Calibrate() {
  const { display, setDisplay } = useGm()
  const applied = display.lastMeasuredMm
  // Shows the last applied measurement; a new one can be typed over it.
  const [measured, setMeasured] = useState(applied === undefined ? '' : String(applied))
  const mm = parseFloat(measured)
  // Applying the same measurement twice would correct twice: wait for a new one.
  const isNew = mm > 0 && mm !== applied
  return (
    <>
      <div className="row">
        <input
          type="number"
          placeholder={`Measured (${CALIBRATION_MM} mm)`}
          value={measured}
          onChange={(e) => setMeasured(e.target.value)}
        />
        <button
          disabled={!isNew}
          onClick={() => setDisplay({ pxPerMm: (display.pxPerMm * CALIBRATION_MM) / mm, lastMeasuredMm: mm })}
        >
          Apply
        </button>
      </div>
      {applied !== undefined && !isNew && (
        <p className="hint">
          Applied {applied} mm: the square should now measure {CALIBRATION_MM} mm. Measure again to check.
        </p>
      )}
    </>
  )
}

