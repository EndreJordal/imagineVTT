import type { RefObject } from 'react'
import { fitSquares, mapNatural, tableScale, viewAlignedToGrid } from '../shared/geometry'
import { AssetsSection } from './Assets'
import { CurtainSection } from './Curtain'
import { HandoutsSection } from './Handouts'
import { CharactersSection } from './Characters'
import { CombatSection } from './Combat'
import { FolderPictures } from './FolderPictures'
import { useSidebar } from './sidebarStore'
import { MeasuringSection } from './Measuring'
import { isMapInUse, mapFolder, chooseMap, useMapFolder } from './mapFolder'
import { DetectGrid } from './DetectGrid'
import type { GmCanvas } from './GmCanvas'
import { PvbOrientation } from './PvbOrientation'
import { finite, positive, round } from './numbers'
import { useShallow } from 'zustand/react/shallow'
import { MM_PER_INCH, useGm } from './store'
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
        rows={3}
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

/** The sidebar's top: Prep or Play (the sections each shows are set in Settings), fold all or open all. */
function SidebarBar() {
  const mode = useSidebar((s) => s.mode)
  const allFolded = useSidebar((s) => s.shown[s.mode].every((id) => s.collapsed.includes(id)))
  const { setMode, collapseAll } = useSidebar.getState()
  return (
    <div className="sidebar-bar">
      <div className="segmented" role="radiogroup" aria-label="Sidebar">
        {(['prep', 'play'] as const).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={mode === m}
            className={mode === m ? 'active' : ''}
            title={m === 'prep' ? 'Setting up: every section you chose for Prep (Settings)' : 'Playing: only the sections you chose for Play (Settings)'}
            onClick={() => setMode(m)}
          >
            {m === 'prep' ? 'Prep' : 'Play'}
          </button>
        ))}
      </div>
      <button className="sidebar-fold" title={allFolded ? 'Open every section' : 'Fold every section'} onClick={() => collapseAll(!allFolded)}>
        <Icon name={allFolded ? 'chevron-down' : 'right'} size={14} /> {allFolded ? 'Expand all' : 'Collapse all'}
      </button>
    </div>
  )
}

const GRID_PRESETS = [
  { name: 'Black', color: '#000000' },
  { name: 'White', color: '#ffffff' },
]
const GRID_WIDTHS = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Thick' },
]

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
      <SidebarBar />
      <Section id="pvb" title="Player View Box (PVB)">
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
        <button
          title="Nudge the table view so the TV's top-left corner sits on a grid corner: whole squares along the top and left, any cut ones at the right and bottom"
          onClick={() => {
            const g = useGm.getState()
            g.setView(viewAlignedToGrid(g.scene, g.display, g.tableScreen))
          }}
        >
          Align PVB to grid
        </button>
        <p className="hint">Drag the yellow triangle to move the PVB.</p>
        {map && (
          <>
            <h3>Map in the PVB</h3>
            <div className="row">
              <button
                disabled={!!map.lockToGrid || !!map.locked}
                title={
                  map.lockToGrid
                    ? 'Unlock from grid to rescale'
                    : map.locked
                      ? 'Unlock the map to fit it'
                      : "Scale the map to the table view's width"
                }
                onClick={() => s.fitMapToView('x')}
              >
                <Icon name="fit-width" /> Fit width
              </button>
              <button
                disabled={!!map.lockToGrid || !!map.locked}
                title={
                  map.lockToGrid
                    ? 'Unlock from grid to rescale'
                    : map.locked
                      ? 'Unlock the map to fit it'
                      : "Scale the map to the table view's height"
                }
                onClick={() => s.fitMapToView('y')}
              >
                <Icon name="fit-height" /> Fit height
              </button>
            </div>
            <button
              className={map.locked ? 'active' : ''}
              aria-pressed={!!map.locked}
              title="Lock the map in place: it can't be moved or resized (also the padlock beside its corner on the map)"
              onClick={() => s.setMapLocked(!map.locked)}
            >
              <Icon name={map.locked ? 'locked' : 'unlocked'} /> Lock map position
            </button>
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
      <CombatSection canvas={canvas} />
      <CharactersSection />
      <MeasuringSection />

      <Section id="map" title="Map">
        <MapPicker />
        {map && (
          <>
            <Field label="Scale (%)">
              <input
                type="number"
                step={1}
                min={5}
                disabled={!!map.lockToGrid || !!map.locked}
                title={
                  map.lockToGrid
                    ? 'Unlock from grid to change the scale'
                    : map.locked
                      ? 'Unlock the map to change its scale'
                      : undefined
                }
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

      <Section id="grid" title="Grid">
        <label className="check">
          <input
            type="checkbox"
            checked={grid.visible}
            onChange={(e) => s.setGrid({ visible: e.target.checked })}
          />
          Show grid
        </label>
        <Field label="Colour">
          <div className="row">
            {GRID_PRESETS.map((c) => (
              <button
                key={c.color}
                className={`measure-color${grid.color.toLowerCase() === c.color ? ' active' : ''}`}
                style={{ background: c.color }}
                title={c.name}
                aria-label={c.name}
                onClick={() => s.setGrid({ color: c.color })}
              />
            ))}
            <input
              type="color"
              className="swatch"
              value={grid.color}
              onChange={(e) => s.setGrid({ color: e.target.value })}
            />
          </div>
        </Field>
        <span className="slider-label">Line thickness</span>
        <div className="segmented" role="radiogroup" aria-label="Grid line thickness">
          {GRID_WIDTHS.map((w) => (
            <button
              key={w.value}
              role="radio"
              aria-checked={(grid.width ?? 1) === w.value}
              className={(grid.width ?? 1) === w.value ? 'active' : ''}
              title={`${w.value} screen pixel${w.value > 1 ? 's' : ''} wide, on the table and here`}
              onClick={() => s.setGrid({ width: w.value })}
            >
              {w.label}
            </button>
          ))}
        </div>
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
        {(() => {
          // Whole squares across (X) or down (Y) the table screen, from its size and calibration.
          const fit = (axis: 'x' | 'y') => fitSquares(axis, tableScreen, display, squareMm, viewZoom)
          const x = fit('x')
          const y = fit('y')
          const where = tableConnected ? 'the table screen' : 'the table screen (as last seen: the table window is closed)'
          const button = (axis: 'X' | 'Y', f: typeof x) =>
            f && (
              <button
                className={Math.abs(f.squareMm - squareMm) < 0.005 ? 'active' : ''}
                title={`Make exactly ${f.count} squares fit ${axis === 'X' ? 'across' : 'down'} ${where}: ${round(f.squareMm, 2)} mm each`}
                onClick={() => s.setSquareMm(round(f.squareMm, 3))}
              >
                Fit {axis} ({f.count})
              </button>
            )
          return (
            <div className="row" title="To the nearest whole number of squares on that axis">
              {button('X', x)}
              {button('Y', y)}
            </div>
          )
        })()}
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
    <Section id="doors" title="Doors">
      <p className="hint">
        When a door opens while something is obscured, what it hid comes into view on the table like this.
        Right-click a door’s button to override it for that door.
      </p>
      <RevealPicker value={reveal} onChange={useGm.getState().setDoorReveal} />
      <DoorSoundsPicker value={sounds} onChange={useGm.getState().setDoorSounds} />
    </Section>
  )
}
