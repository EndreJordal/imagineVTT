import { useState, type ReactNode, type RefObject } from 'react'
import { CALIBRATION_MM, tableScale } from '../shared/geometry'
import { DetectGrid } from './DetectGrid'
import type { GmCanvas } from './GmCanvas'
import { PvbOrientation } from './PvbOrientation'
import { WallsSection } from './Walls'
import { MM_PER_INCH, useGm } from './store'

function openTableWindow() {
  window.open(`${location.pathname}?view=table`, 'imaginevtt-table', 'popup,width=1280,height=720')
}

async function readImage(file: File) {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

export function Sidebar({ canvas }: { canvas: RefObject<GmCanvas | null> }) {
  const s = useGm()
  const { grid, map } = s.scene

  return (
    <aside className="sidebar">

      <Section title="Player View Box (PVB)">
        <button onClick={openTableWindow}>Open table window</button>
        <p className="hint">
          {s.tableConnected
            ? `Connected · ${s.tableScreen.width}×${s.tableScreen.height}`
            : 'Not connected. Open it, drag it to the TV and double-click it for fullscreen.'}
        </p>
        <p className="hint">
          Shows {(s.tableScreen.width / tableScale(s.scene, s.display) / grid.size).toFixed(1)} ×{' '}
          {(s.tableScreen.height / tableScale(s.scene, s.display) / grid.size).toFixed(1)} squares
          {!s.tableConnected && ` (last known ${s.tableScreen.width}×${s.tableScreen.height})`}
        </p>
        <PvbOrientation />
        <button
          onClick={() => {
            const c = canvas.current?.centre()
            if (c) s.setView(c)
          }}
        >
          Move PVB here
        </button>
        <p className="hint">Drag the yellow triangle to move the PVB.</p>
      </Section>

      <Section title="Calibration">
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
      </Section>

      <Section title="Grid square / base size">
        <div className="row">
          <button
            className={s.scene.squareMm === MM_PER_INCH ? 'active' : ''}
            onClick={() => s.setSquareMm(MM_PER_INCH)}
          >
            1 inch
          </button>
          <button
            className={s.scene.squareMm === 25 ? 'active' : ''}
            onClick={() => s.setSquareMm(25)}
          >
            25 mm
          </button>
        </div>
        <Field label="Size (mm)">
          <input
            type="number"
            step={0.1}
            min={5}
            value={s.scene.squareMm}
            onChange={(e) => positive(e.target.valueAsNumber, s.setSquareMm)}
          />
        </Field>
      </Section>

      <Section title="Map">
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) s.setMap(file, await readImage(file))
            e.target.value = ''
          }}
        />
        {map && (
          <>
            <Field label="Scale (%)">
              <input
                type="number"
                step={1}
                min={5}
                disabled={!!map.lockToGrid}
                title={map.lockToGrid ? 'Unlock from grid to change the scale' : undefined}
                value={round((map.width / map.naturalWidth) * 100, 1)}
                onChange={(e) => positive(e.target.valueAsNumber, (pct) => s.setMapScale(pct / 100))}
              />
            </Field>
            <p className="hint">
              {(map.width / grid.size).toFixed(1)} × {(map.height / grid.size).toFixed(1)} squares ·
              image {map.naturalWidth}×{map.naturalHeight} px.{' '}
              {map.lockToGrid
                ? 'Locked to the grid: dragging the map moves the grid with it.'
                : 'Drag the map to move it, or its blue corner to resize.'}
            </p>
            <DetectGrid />
            <button
              className={map.lockToGrid ? 'active' : ''}
              aria-pressed={!!map.lockToGrid}
              title="Keep the map matched to the grid: they move and scale together"
              onClick={() => s.setMapLockToGrid(!map.lockToGrid)}
            >
              {map.lockToGrid ? '🔒' : '🔓'} Lock to grid
            </button>
            <div className="row">
              <button
                disabled={!!map.lockToGrid}
                title={map.lockToGrid ? 'Unlock from grid to rescale' : "Scale the map to the table view's width"}
                onClick={() => s.fitMapToView('x')}
              >
                ↔ Fit width
              </button>
              <button
                disabled={!!map.lockToGrid}
                title={map.lockToGrid ? 'Unlock from grid to rescale' : "Scale the map to the table view's height"}
                onClick={() => s.fitMapToView('y')}
              >
                ↕ Fit height
              </button>
            </div>
            <div className="row">
              <button
                className={map.lockX ? 'active' : ''}
                aria-pressed={!!map.lockX}
                title="Stop dragging from moving the map left/right"
                onClick={() => s.setMapLock('x', !map.lockX)}
              >
                {map.lockX ? '🔒' : '🔓'} Lock X
              </button>
              <button
                className={map.lockY ? 'active' : ''}
                aria-pressed={!!map.lockY}
                title="Stop dragging from moving the map up/down"
                onClick={() => s.setMapLock('y', !map.lockY)}
              >
                {map.lockY ? '🔒' : '🔓'} Lock Y
              </button>
            </div>
            <button onClick={() => s.setMap(null, null)}>Remove map</button>
          </>
        )}
        <button onClick={() => canvas.current?.fit()}>Zoom to map</button>
      </Section>

      <WallsSection />

      <Section title="Grid">
        <label className="check">
          <input
            type="checkbox"
            checked={grid.visible}
            onChange={(e) => s.setGrid({ visible: e.target.checked })}
          />
          Show grid
        </label>
        <Field label="Colour">
          <input
            type="color"
            className="swatch"
            value={grid.color}
            onChange={(e) => s.setGrid({ color: e.target.value })}
          />
        </Field>
        <Field label={`Opacity ${Math.round(grid.opacity * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={grid.opacity}
            onChange={(e) => s.setGrid({ opacity: e.target.valueAsNumber })}
          />
        </Field>
        <Field label="Square size">
          <input
            type="number"
            step={0.5}
            min={4}
            value={grid.size}
            onChange={(e) => positive(e.target.valueAsNumber, (size) => s.setGrid({ size }))}
          />
        </Field>
        <Field label="Offset X">
          <input
            type="number"
            value={round(grid.offsetX, 2)}
            onChange={(e) => finite(e.target.valueAsNumber, (offsetX) => s.setGrid({ offsetX }))}
          />
        </Field>
        <Field label="Offset Y">
          <input
            type="number"
            value={round(grid.offsetY, 2)}
            onChange={(e) => finite(e.target.valueAsNumber, (offsetY) => s.setGrid({ offsetY }))}
          />
        </Field>
      </Section>
    </aside>
  )
}

/** Measure the on-table square with a ruler and enter the result to correct the scale. */
function Calibrate() {
  const [measured, setMeasured] = useState('')
  const { display, setDisplay } = useGm()
  const mm = parseFloat(measured)
  return (
    <div className="row">
      <input
        type="number"
        placeholder={`Measured (${CALIBRATION_MM} mm)`}
        value={measured}
        onChange={(e) => setMeasured(e.target.value)}
      />
      <button
        disabled={!(mm > 0)}
        onClick={() => {
          setDisplay({ pxPerMm: (display.pxPerMm * CALIBRATION_MM) / mm })
          setMeasured('')
        }}
      >
        Apply
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function round(n: number, digits: number) {
  return Math.round(n * 10 ** digits) / 10 ** digits
}

function positive(n: number, set: (n: number) => void) {
  if (Number.isFinite(n) && n > 0) set(n)
}

function finite(n: number, set: (n: number) => void) {
  if (Number.isFinite(n)) set(n)
}
