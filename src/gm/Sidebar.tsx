import type { RefObject } from 'react'
import { tableScale } from '../shared/geometry'
import { DetectGrid } from './DetectGrid'
import type { GmCanvas } from './GmCanvas'
import { PvbOrientation } from './PvbOrientation'
import { finite, positive, round } from './numbers'
import { MM_PER_INCH, useGm } from './store'
import { openTableWindow } from './tableWindow'
import { Field, Section, Slider } from './ui'

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
            : 'Not connected. Open it, drag it to the TV, click it and press F11 for fullscreen.'}
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
        {map && (
          <>
            <h3>Map in the PVB</h3>
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
          </>
        )}
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
            <button onClick={() => s.setMap(null, null)}>Remove map</button>
          </>
        )}
        <button onClick={() => canvas.current?.fit()}>Zoom to map</button>
      </Section>

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
        <Slider
          label="Opacity"
          value={grid.opacity}
          fallback={grid.opacity}
          min={0}
          max={1}
          step={0.05}
          scale={100}
          unit="%"
          onChange={(opacity) => s.setGrid({ opacity })}
        />
        {map && (
          <>
            <h3>Match the map</h3>
            <DetectGrid />
            <button
              className={map.lockToGrid ? 'active' : ''}
              aria-pressed={!!map.lockToGrid}
              title="Keep the map matched to the grid: they move and scale together"
              onClick={() => s.setMapLockToGrid(!map.lockToGrid)}
            >
              {map.lockToGrid ? '🔒' : '🔓'} Lock to grid
            </button>
          </>
        )}
        <h3>Physical grid size</h3>
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
        <Field label="Square (mm)">
          <input
            type="number"
            step={0.1}
            min={5}
            value={s.scene.squareMm}
            onChange={(e) => positive(e.target.valueAsNumber, s.setSquareMm)}
          />
        </Field>
        <details className="manual-adjust">
          <summary>Manual adjust</summary>
          <p className="hint">
            Hand-tuning, for when Detect grid is slightly off. Square size is grid spacing in map units;
            offsets slide the grid lines.
          </p>
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
        </details>
      </Section>
    </aside>
  )
}
