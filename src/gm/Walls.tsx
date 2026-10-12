import { selectedSegment } from '../shared/walls'
import { AutoWalls } from './AutoWalls'
import { useGm } from './store'
import { SELECT } from './tools'
import { DEFAULT_DOOR_REVEAL, DOOR_EFFECTS, type DoorReveal } from '../shared/doors'
import { Slider } from './ui'
import { Icon } from './icons'
import { DEFAULT_DOOR_SOUNDS } from '../shared/sound'
import { DoorSoundsPicker } from './Sound'

/** Selection box for wall points: how many, and delete them. */
export function WallPointsPanel() {
  const count = useGm((s) => s.selectedWallPoints.length)
  const canConvert = useGm((s) => !!selectedSegment(s.scene.walls, s.selectedWallPoints))
  if (!count) return null
  const { deleteWallPoints, convertToDoor, selectedWallPoints } = useGm.getState()
  return (
    <aside className="light-panel" aria-label="Selected wall points">
      <header>
        <span className="light-panel-title">
          <Icon name="walls" /> {count} wall point{count === 1 ? '' : 's'} selected
        </span>
      </header>
      <p className="hint">Drag a point to move them. Deleting cuts the walls there.</p>
      <button onClick={() => deleteWallPoints(selectedWallPoints)}>
        Delete {count === 1 ? 'wall point' : `${count} wall points`}
      </button>
      {canConvert && (
        <button title="Turn the wall between these two points into a door" onClick={() => convertToDoor(selectedWallPoints)}>
          <Icon name="doors" /> Convert wall points to door
        </button>
      )}
    </aside>
  )
}

/** Floating help while building doors. */
export function DoorToolbox() {
  const building = useGm((s) => s.tool.kind === 'doors')
  const started = useGm((s) => !!s.doorDraft)
  if (!building) return null
  const { cancelDoorDraft, setTool } = useGm.getState()

  return (
    <aside className="light-panel wall-toolbox" aria-label="Door building">
      <header>
        <span className="light-panel-title">
          <Icon name="doors" /> Building doors
        </span>
        <button className="icon-button" title="Stop building doors" onClick={() => setTool(SELECT)}>
          <Icon name="close" />
        </button>
      </header>
      <p className="hint">
        {started
          ? 'Now click the other end, on the same stretch of wall.'
          : 'Click a wall line where the door starts; the green dot shows valid points.'}
      </p>
      <ul className="key-list">
        <li>
          <kbd>Enter</kbd> or right-click: done
        </li>
        <li>
          <kbd>Esc</kbd> {started ? 'cancel this door' : 'stop building doors'}
        </li>
        <li>Click a door’s middle button to open or close it.</li>
        <li>Right-click it for the door’s settings (how it reveals what it hid).</li>
      </ul>
      {started && <button onClick={cancelDoorDraft}>Cancel</button>}
    </aside>
  )
}

/** Floating help and actions while building walls. */
export function WallToolbox() {
  const building = useGm((s) => s.tool.kind === 'walls')
  const points = useGm((s) => s.wallDraft.length)
  const total = useGm((s) => s.scene.walls.length)
  if (!building) return null
  const { confirmWallDraft, cancelWallDraft, setTool, clearWalls } = useGm.getState()

  return (
    <aside className="light-panel wall-toolbox" aria-label="Wall building">
      <header>
        <span className="light-panel-title">
          <Icon name="walls" /> Building walls
        </span>
        <button className="icon-button" title="Stop building walls" onClick={() => setTool(SELECT)}>
          <Icon name="close" />
        </button>
      </header>
      <p className="hint">Click to add wall points; the red dot shows where the next one goes.</p>
      <ul className="key-list">
        <li>
          <kbd>Enter</kbd> or right-click: confirm the wall; again to stop building
        </li>
        <li>
          <kbd>Esc</kbd> cancel wall points
        </li>
        <li>
          <kbd>Backspace</kbd> remove the last point
        </li>
      </ul>
      <div className="row">
        <button disabled={points < 2} onClick={confirmWallDraft}>
          Confirm{points ? ` (${points})` : ''}
        </button>
        <button disabled={points === 0} onClick={cancelWallDraft}>
          Cancel
        </button>
      </div>
      <AutoWalls />
      {total > 0 && (
        <button
          onClick={() => {
            if (confirm('Remove all walls and doors?')) clearWalls()
          }}
        >
          Remove all walls &amp; doors
        </button>
      )}
    </aside>
  )
}

/** Picking a reveal effect and its time. */
export function RevealPicker(props: { value: DoorReveal; onChange(reveal: DoorReveal): void }) {
  const { value, onChange } = props
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Effect">
        {DOOR_EFFECTS.map((e) => (
          <button
            key={e.value}
            role="radio"
            aria-checked={value.effect === e.value}
            className={value.effect === e.value ? 'active' : ''}
            onClick={() => onChange({ ...value, effect: e.value })}
          >
            {e.label}
          </button>
        ))}
      </div>
      <Slider
        label="Time"
        unit="s"
        value={value.duration}
        fallback={DEFAULT_DOOR_REVEAL.duration}
        min={0.2}
        max={5}
        step={0.1}
        disabled={value.effect === 'none'}
        title="How long the reveal takes"
        onChange={(duration) => onChange({ ...value, duration })}
      />
    </>
  )
}

/**
 * A door's settings (right-click on its button): how what it hid comes into view on the
 * table when it's opened. Doors follow the settings for all doors (sidebar) unless overridden.
 */
export function DoorPanel() {
  const door = useGm((s) => s.scene.walls.find((w) => w.id === s.selectedDoorId && w.door))
  const all = useGm((s) => s.scene.doorReveal ?? DEFAULT_DOOR_REVEAL)
  const allSounds = useGm((s) => s.scene.doorSounds ?? DEFAULT_DOOR_SOUNDS)
  if (!door?.door) return null
  const { selectDoor, setDoorOwnReveal, setDoorOwnSounds, toggleDoor } = useGm.getState()
  const own = door.door.reveal
  const ownSounds = door.door.sounds

  return (
    <aside className="light-panel" aria-label="Door">
      <header>
        <span className="light-panel-title">
          <Icon name="doors" /> Door
        </span>
        <button className="icon-button" title="Close" onClick={() => selectDoor(null)}>
          <Icon name="close" />
        </button>
      </header>
      <button onClick={() => toggleDoor(door.id)}>{door.door.open ? 'Close the door' : 'Open the door'}</button>
      <label className="check" title="How what it hid comes into view when it opens">
        <input
          type="checkbox"
          checked={!!own}
          onChange={(e) => setDoorOwnReveal(door.id, e.target.checked ? { ...all } : undefined)}
        />
        Override door settings
      </label>
      {own ? (
        <RevealPicker value={own} onChange={(reveal) => setDoorOwnReveal(door.id, reveal)} />
      ) : (
        <p className="hint">Opens like all doors (Doors, in the sidebar).</p>
      )}
      <label className="check" title="The sounds it makes opening and closing">
        <input
          type="checkbox"
          checked={!!ownSounds}
          onChange={(e) => setDoorOwnSounds(door.id, e.target.checked ? { ...allSounds } : undefined)}
        />
        Own sounds
      </label>
      {ownSounds ? (
        <DoorSoundsPicker value={ownSounds} onChange={(sounds) => setDoorOwnSounds(door.id, sounds)} />
      ) : (
        <p className="hint">Sounds like all doors.</p>
      )}
    </aside>
  )
}
