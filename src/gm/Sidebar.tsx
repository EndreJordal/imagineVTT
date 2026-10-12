import type { RefObject } from 'react'
import { mapNatural, tableScale } from '../shared/geometry'
import { AssetsSection } from './Assets'
import { CurtainSection } from './Curtain'
import { HandoutsSection } from './Handouts'
import { FolderPictures } from './FolderPictures'
import { isMapInUse, mapFolder, chooseMap, useMapFolder } from './mapFolder'
import { DetectGrid } from './DetectGrid'
import type { GmCanvas } from './GmCanvas'
import { PvbOrientation } from './PvbOrientation'
import { finite, positive, round } from './numbers'
import { useShallow } from 'zustand/react/shallow'
import { MM_PER_INCH, useGm } from './store'
import { openTableWindow } from './tableWindow'
import { Field, Section, Slider } from './ui'
import { Icon } from './icons'
import { DEFAULT_DOOR_REVEAL } from '../shared/doors'
import { RevealPicker } from './Walls'
import { DEFAULT_DOOR_SOUNDS } from '../shared/sound'
import { DoorSoundsPicker } from './Sound'

async function readImage(file: File) {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

/** The maps folder's pictures, to pick the scene's map from (a file, where folders can't be opened). */
function MapPicker() {
  const state = useMapFolder()
  const mapImage = useGm((g) => g.mapImage)
  const selected = state.images.find((i) => i.id === state.selectedId)
  if (state.status === 'unsupported') {
    return (
      <input
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (file) useGm.getState().setMap(file, await readImage(file))
          e.target.value = ''
        }}
      />
    )
  }
  const inUse = (file: File) => isMapInUse(file, mapImage)
  return (
    <>
      <FolderPictures
        state={state}
        folder={mapFolder}
        what="maps"
        ns="map:"
        onSelect={(selectedId) => useMapFolder.setState({ selectedId })}
        onOpen={(id) => void chooseMap(id)}
        thumb={(image) =>
          inUse(image.file) ? { className: 'showing', title: `“${image.id}”: the map in use` } : {}
        }
      />
      {selected && (
        <button disabled={inUse(selected.file)} onClick={() => void chooseMap(selected.id)}>
          {inUse(selected.file) ? 'In use' : `Use “${selected.name}” as map`}
        </button>
      )}
    </>
  )
}

export function Sidebar({ canvas }: { canvas: RefObject<GmCanvas | null> }) {
  // Only what the sidebar shows: the store changes on every drag, the sidebar rarely.
  const { grid, map, squareMm, viewZoom, tableScreen, tableConnected, display } = useGm(
    useShallow((g) => ({
      grid: g.scene.grid,
      map: g.scene.map,
      squareMm: g.scene.squareMm,
      viewZoom: g.scene.viewZoom,
      tableScreen: g.tableScreen,
      tableConnected: g.tableConnected,
      display: g.display,
    })),
  )
  const s = useGm.getState()
  const scale = tableScale({ grid, squareMm, viewZoom }, display)

  return (
    <aside className="sidebar">
      <Section title="Player View Box (PVB)">
        <button onClick={openTableWindow}>Open table window</button>
        <p className="hint">
          {tableConnected
            ? `Connected · ${tableScreen.width}×${tableScreen.height}`
            : 'Not connected. Open it, drag it to the TV, click it and press F11 for fullscreen.'}
        </p>
        <p className="hint">
          Shows {(tableScreen.width / scale / grid.size).toFixed(1)} ×{' '}
          {(tableScreen.height / scale / grid.size).toFixed(1)} squares
          {!tableConnected && ` (last known ${tableScreen.width}×${tableScreen.height})`}
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
                <Icon name="fit-width" /> Fit width
              </button>
              <button
                disabled={!!map.lockToGrid}
                title={map.lockToGrid ? 'Unlock from grid to rescale' : "Scale the map to the table view's height"}
                onClick={() => s.fitMapToView('y')}
              >
                <Icon name="fit-height" /> Fit height
              </button>
            </div>
            <div className="row">
              <button
                className={map.lockX ? 'active' : ''}
                aria-pressed={!!map.lockX}
                title="Stop dragging from moving the map left/right"
                onClick={() => s.setMapLock('x', !map.lockX)}
              >
                <Icon name={map.lockX ? 'locked' : 'unlocked'} /> Lock X
              </button>
              <button
                className={map.lockY ? 'active' : ''}
                aria-pressed={!!map.lockY}
                title="Stop dragging from moving the map up/down"
                onClick={() => s.setMapLock('y', !map.lockY)}
              >
                <Icon name={map.lockY ? 'locked' : 'unlocked'} /> Lock Y
              </button>
            </div>
          </>
        )}
      </Section>
      <CurtainSection />
      <HandoutsSection />

      <Section title="Map">
        <MapPicker />
        {map && (
          <>
            <Field label="Scale (%)">
              <input
                type="number"
                step={1}
                min={5}
                disabled={!!map.lockToGrid}
                title={map.lockToGrid ? 'Unlock from grid to change the scale' : undefined}
                value={round((map.width / mapNatural(map).width) * 100, 1)}
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
            <div className="row">
              <button
                onClick={() => s.turnMap(-1)}
                title="Turn the map a quarter turn anticlockwise, with its walls, lights, objects and explored areas"
              >
                <Icon name="turn-left" /> Turn left
              </button>
              <button
                onClick={() => s.turnMap(1)}
                title="Turn the map a quarter turn clockwise, with its walls, lights, objects and explored areas"
              >
                <Icon name="turn-right" /> Turn right
              </button>
            </div>
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
              <Icon name={map.lockToGrid ? 'locked' : 'unlocked'} /> Lock to grid
            </button>
          </>
        )}
        <h3>Physical grid size</h3>
        <div className="row">
          <button
            className={squareMm === MM_PER_INCH ? 'active' : ''}
            onClick={() => s.setSquareMm(MM_PER_INCH)}
          >
            1 inch
          </button>
          <button
            className={squareMm === 25 ? 'active' : ''}
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
            value={squareMm}
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
      <DoorsSection />
      <AssetsSection />
    </aside>
  )
}

/** How doors reveal what they hid when opened on the table (each can override it). */
function DoorsSection() {
  const reveal = useGm((g) => g.scene.doorReveal ?? DEFAULT_DOOR_REVEAL)
  const sounds = useGm((g) => g.scene.doorSounds ?? DEFAULT_DOOR_SOUNDS)
  return (
    <Section title="Doors">
      <p className="hint">
        When a door opens while something is obscured, what it hid comes into view on the table like this.
        Right-click a door’s button to override it for that door.
      </p>
      <RevealPicker value={reveal} onChange={useGm.getState().setDoorReveal} />
      <DoorSoundsPicker value={sounds} onChange={useGm.getState().setDoorSounds} />
    </Section>
  )
}
