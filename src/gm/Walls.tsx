import { useGm } from './store'

const SNAPS = [
  { fraction: 1, label: '1', title: 'Snap to grid corners' },
  { fraction: 0.5, label: '½', title: 'Snap to half squares' },
  { fraction: 0.25, label: '¼', title: 'Snap to quarter squares' },
  { fraction: 0, label: 'Off', title: 'No snapping' },
]

/** Sidebar section: build walls, snapping, and clearing them. */
export function WallsSection() {
  const building = useGm((s) => s.buildingWalls)
  const snap = useGm((s) => s.wallSnap)
  const count = useGm((s) => s.scene.walls.length)
  const { setBuildingWalls, setWallSnap, clearWalls } = useGm.getState()

  return (
    <section>
      <h2>Walls</h2>
      <button
        className={building ? 'active' : ''}
        aria-pressed={building}
        title="Draw walls that block the party's sight"
        onClick={() => setBuildingWalls(!building)}
      >
        🧱 {building ? 'Building walls…' : 'Build walls'}
      </button>
      <div className="field">
        <span>Snap</span>
        <div className="row snap-options" role="radiogroup" aria-label="Wall snapping">
          {SNAPS.map((o) => (
            <button
              key={o.fraction}
              role="radio"
              aria-checked={snap === o.fraction}
              className={snap === o.fraction ? 'active' : ''}
              title={o.title}
              onClick={() => setWallSnap(o.fraction)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        {count === 0 ? 'No walls yet.' : `${count} wall${count === 1 ? '' : 's'}. They block sight under fog of war.`}
      </p>
      {count > 0 && (
        <button
          onClick={() => {
            if (confirm(`Remove all ${count} walls?`)) clearWalls()
          }}
        >
          Remove all walls
        </button>
      )}
    </section>
  )
}

/** Selection box for wall points: how many, and delete them. */
export function WallPointsPanel() {
  const count = useGm((s) => s.selectedWallPoints.length)
  if (!count) return null
  const { deleteWallPoints, selectedWallPoints } = useGm.getState()
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
    </aside>
  )
}

/** Floating help and actions while building walls. */
export function WallToolbox() {
  const building = useGm((s) => s.buildingWalls)
  const points = useGm((s) => s.wallDraft.length)
  if (!building) return null
  const { confirmWallDraft, cancelWallDraft, setBuildingWalls } = useGm.getState()

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
    </aside>
  )
}
