import { selectedSegment } from '../shared/walls'
import { AutoWalls } from './AutoWalls'
import { useGm } from './store'

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
          🧱 {count} wall point{count === 1 ? '' : 's'} selected
        </span>
      </header>
      <p className="hint">Drag a point to move them. Deleting cuts the walls there.</p>
      <button onClick={() => deleteWallPoints(selectedWallPoints)}>
        Delete {count === 1 ? 'wall point' : `${count} wall points`}
      </button>
      {canConvert && (
        <button title="Turn the wall between these two points into a door" onClick={() => convertToDoor(selectedWallPoints)}>
          🚪 Convert wall points to door
        </button>
      )}
    </aside>
  )
}

/** Floating help while building doors. */
export function DoorToolbox() {
  const building = useGm((s) => s.buildingDoors)
  const started = useGm((s) => !!s.doorDraft)
  if (!building) return null
  const { cancelDoorDraft, setBuildingDoors } = useGm.getState()

  return (
    <aside className="light-panel wall-toolbox" aria-label="Door building">
      <header>
        <span className="light-panel-title">🚪 Building doors</span>
        <button className="icon-button" title="Stop building doors" onClick={() => setBuildingDoors(false)}>
          ✕
        </button>
      </header>
      <p className="hint">
        {started
          ? 'Now click the other end, on the same stretch of wall.'
          : 'Click a wall line where the door starts; the green dot shows valid points.'}
      </p>
      <ul className="key-list">
        <li>
          <kbd>Esc</kbd> {started ? 'cancel this door' : 'stop building doors'}
        </li>
        <li>Click a door’s middle button to open or close it.</li>
      </ul>
      {started && <button onClick={cancelDoorDraft}>Cancel</button>}
    </aside>
  )
}

/** Floating help and actions while building walls. */
export function WallToolbox() {
  const building = useGm((s) => s.buildingWalls)
  const points = useGm((s) => s.wallDraft.length)
  const total = useGm((s) => s.scene.walls.length)
  if (!building) return null
  const { confirmWallDraft, cancelWallDraft, setBuildingWalls, clearWalls } = useGm.getState()

  return (
    <aside className="light-panel wall-toolbox" aria-label="Wall building">
      <header>
        <span className="light-panel-title">🧱 Building walls</span>
        <button className="icon-button" title="Stop building walls" onClick={() => setBuildingWalls(false)}>
          ✕
        </button>
      </header>
      <p className="hint">Click to add wall points; the red dot shows where the next one goes.</p>
      <ul className="key-list">
        <li>
          <kbd>Enter</kbd> confirm wall points
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
