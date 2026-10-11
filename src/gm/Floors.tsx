import { useGm } from './store'
import { useDropdown } from './useDropdown'
import { Icon } from './icons'

/**
 * Floor switcher, over the map: the floors as tabs (the one on the table marked with a TV). Viewing
 * a floor doesn't change the table; "Show on table" does, and the party goes along.
 */
export function Floors() {
  const levels = useGm((s) => s.levels)
  const levelId = useGm((s) => s.levelId)
  const tableLevelId = useGm((s) => s.tableLevelId)
  const onionSkin = useGm((s) => s.onionSkin)
  const zoom = useGm((s) => s.scene.viewZoom ?? 1)
  const { viewLevel, showLevelOnTable, addLevel, renameLevel, moveLevel, deleteLevel, setOnionSkin, setViewZoom } =
    useGm.getState()
  const { open: menuOpen, setOpen: setMenuOpen, root: menuRoot } = useDropdown()
  const index = levels.findIndex((l) => l.id === levelId)
  const current = levels[index]
  const tableName = levels.find((l) => l.id === tableLevelId)?.name

  return (
    <nav className="floors" aria-label="Floors">
      <div className="floor-tabs" role="tablist">
        {levels.map((l) => (
          <button
            key={l.id}
            role="tab"
            aria-selected={l.id === levelId}
            className={`floor-tab${l.id === levelId ? ' active' : ''}`}
            title={l.id === tableLevelId ? `${l.name} (on the table)` : `View ${l.name}`}
            onClick={() => viewLevel(l.id)}
            onDoubleClick={() => {
              const name = prompt('Floor name', l.name)
              if (name) renameLevel(l.id, name)
            }}
          >
            {l.id === tableLevelId && <Icon name="table" size={14} />}
            {l.name}
          </button>
        ))}
        <button className="floor-tab floor-add" title="Add a floor" onClick={addLevel}>
          <Icon name="add" />
        </button>
        <div className="menu" ref={menuRoot}>
          <button
            className={`floor-tab${menuOpen ? ' active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Floor options"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Icon name="more" />
          </button>
          {menuOpen && current && (
            <div className="menu-list settings-panel floor-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  const name = prompt('Floor name', current.name)
                  if (name) renameLevel(current.id, name)
                  setMenuOpen(false)
                }}
              >
                Rename “{current.name}”…
              </button>
              <div className="row">
                <button role="menuitem" disabled={index <= 0} onClick={() => moveLevel(current.id, -1)}>
                  <Icon name="left" /> Move left
                </button>
                <button role="menuitem" disabled={index >= levels.length - 1} onClick={() => moveLevel(current.id, 1)}>
                  Move right <Icon name="right" />
                </button>
              </div>
              <label className="check" title="The floor to the left, faintly over this one: line up stairs and walls">
                <input type="checkbox" checked={onionSkin} onChange={(e) => setOnionSkin(e.target.checked)} />
                Show the floor below faintly
              </label>
              <button
                role="menuitem"
                disabled={levels.length <= 1}
                onClick={() => {
                  if (confirm(`Delete “${current.name}” with its map, walls, lights and objects?`)) deleteLevel(current.id)
                  setMenuOpen(false)
                }}
              >
                Delete floor
              </button>
            </div>
          )}
        </div>
      </div>
      {zoom !== 1 && (
        <div className="floor-preview">
          <span>
            The table is zoomed {zoom < 1 ? 'out' : 'in'} to <b>{Math.round(zoom * 100)}%</b>: squares don’t match
            the minis.
          </span>
          <button className="active" onClick={() => setViewZoom(1)}>
            <Icon name="table" /> Back to true scale
          </button>
        </div>
      )}
      {levelId !== tableLevelId && (
        <div className="floor-preview">
          <span>
            Preparing <b>{current?.name}</b>. The table shows {tableName}.
          </span>
          <button className="active" onClick={() => showLevelOnTable()}>
            <Icon name="table" /> Show on table
          </button>
        </div>
      )}
    </nav>
  )
}
