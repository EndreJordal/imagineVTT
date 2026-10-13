import { useState } from 'react'
import { CALIBRATION_MM } from '../shared/geometry'
import { positive, round } from './numbers'
import { Field } from './ui'
import { SoundOutput } from './Sound'
import { useGm } from './store'
import { useDropdown } from './useDropdown'
import { chooseScenesFolder, reconnectScenesFolder, useScenesFolder } from './scenesFolder'
import { Icon } from './icons'

/** Toolbar settings button: settings that rarely change (calibration, for now). */
export function SettingsMenu() {
  const { open, setOpen, root } = useDropdown()
  const calibrating = useGm((g) => g.calibrating)
  const display = useGm((g) => g.display)
  const s = { ...useGm.getState(), calibrating, display }
  return (
    <div className="menu" ref={root}>
      <button
        className={`icon-button settings-button${open ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Settings"
        onClick={() => setOpen(!open)}
      >
        <Icon name="settings" size={18} />
      </button>
      {open && (
        <div className="menu-list menu-right settings-panel" role="dialog" aria-label="Settings">
          <h2>Scenes folder</h2>
          <ScenesFolderSetting />
          <h2>Sound output</h2>
          <SoundOutput />
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

/** Where scenes are kept by name: combat links open theirs, and saving writes straight back. */
function ScenesFolderSetting() {
  const { name, status } = useScenesFolder()
  if (status === 'unsupported') return <p className="hint">This browser can’t keep a scenes folder (it needs Chrome or Edge).</p>
  return (
    <>
      {name && (
        <p className="hint">
          <Icon name="folder" size={14} /> {name}
          {status === 'reconnect' && ' (the browser asks again on each visit)'}
        </p>
      )}
      <div className="row">
        {status === 'reconnect' && <button onClick={() => void reconnectScenesFolder()}>Allow it again</button>}
        <button onClick={() => void chooseScenesFolder()}>{name ? 'Change…' : 'Choose scenes folder…'}</button>
      </div>
      <p className="hint">Combat links open their scene from here; scenes from it save straight back (Ctrl+S).</p>
    </>
  )
}

/** Measure the on-table square with a ruler and enter the result to correct the scale. */
function Calibrate() {
  const display = useGm((g) => g.display)
  const { setDisplay } = useGm.getState()
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

