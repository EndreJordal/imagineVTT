import { useEffect, type ReactNode } from 'react'
import { LIGHT_MENU, LIGHT_PRESETS, type LightKind } from '../shared/lights'
import { useGm } from './store'
import { useDropdown } from './useDropdown'
import { Icon, LightKindIcon } from './icons'

const SNAPS = [
  { fraction: 1, label: '1', title: 'Grid corners' },
  { fraction: 0.5, label: '½', title: 'Half squares' },
  { fraction: 0.25, label: '¼', title: 'Quarter squares' },
  { fraction: 0, label: 'Off', title: 'No snapping' },
]

/** Leave any tool: back to selecting and dragging. */
function selectTool() {
  const gm = useGm.getState()
  gm.setBuildingWalls(false)
  gm.setBuildingDoors(false)
  gm.setPlacingLight(null)
  gm.setHideTool(null)
}

/**
 * Tools on a strip at the map's left edge: select, build walls, build doors, place a light,
 * hide areas. Keys: Esc select, W walls, D doors, L lights, H hide.
 */
export function ToolPalette() {
  const walls = useGm((s) => s.buildingWalls)
  const doors = useGm((s) => s.buildingDoors)
  const placing = useGm((s) => s.placingLight)
  const hiding = useGm((s) => !!s.hideTool)
  const { open: lightsOpen, setOpen, root: lightsRoot } = useDropdown()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const el = e.target
      if (el instanceof Element && el.closest('input, textarea, select, [contenteditable]')) return
      const gm = useGm.getState()
      const key = e.key.toLowerCase()
      if (key === 'w') gm.setBuildingWalls(!gm.buildingWalls)
      else if (key === 'd') gm.setBuildingDoors(!gm.buildingDoors)
      else if (key === 'l') setOpen((open) => !open)
      else if (key === 'h') gm.toggleHideTool()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const pick = (kind: LightKind) => {
    useGm.getState().setPlacingLight(kind)
    setOpen(false)
  }
  const idle = !walls && !doors && !placing && !hiding

  return (
    <nav className="tool-palette" aria-label="Tools">
      <ToolButton icon={<Icon name="select" size={20} />} label="Select and move" keyName="Esc" active={idle} onClick={selectTool} />
      <ToolButton
        icon={<Icon name="walls" size={20} />}
        label="Build walls"
        keyName="W"
        active={walls}
        onClick={() => useGm.getState().setBuildingWalls(!walls)}
      />
      <ToolButton
        icon={<Icon name="doors" size={20} />}
        label="Build doors"
        keyName="D"
        active={doors}
        onClick={() => useGm.getState().setBuildingDoors(!doors)}
      />
      <ToolButton
        icon={<Icon name="hide" size={20} />}
        label="Hide areas (local fog)"
        keyName="H"
        active={hiding}
        onClick={() => useGm.getState().toggleHideTool()}
      />
      <div className="menu" ref={lightsRoot}>
        <ToolButton
          icon={placing ? <LightKindIcon icon={LIGHT_PRESETS[placing].icon} size={20} /> : <Icon name="lights" size={20} />}
          label="Add a light"
          keyName="L"
          active={!!placing || lightsOpen}
          onClick={() => setOpen(!lightsOpen)}
        />
        {lightsOpen && (
          <ul className="menu-list tool-flyout" role="menu">
            {LIGHT_MENU.map(({ kind, label }) => {
              const p = LIGHT_PRESETS[kind]
              return (
                <li key={kind} role="none">
                  <button role="menuitem" onClick={() => pick(kind)}>
                    <span className="menu-icon" aria-hidden>
                      <LightKindIcon icon={p.icon} />
                    </span>
                    <span className="menu-label">{label}</span>
                    {p.handheld && (
                      <span className="menu-badge" title="Hand-held: meant to be moved">
                        <Icon name="hand-held" size={14} />
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <SnapMenu />
    </nav>
  )
}

/** Snapping for walls, doors and placing lights: shows the current setting, opens the options. */
function SnapMenu() {
  const snap = useGm((s) => s.snap)
  const { open, setOpen, root } = useDropdown()
  const current = SNAPS.find((o) => o.fraction === snap) ?? SNAPS[0]
  return (
    <div className="menu snap-menu" ref={root}>
      <button
        className={`tool-button snap-button${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Snap to grid: ${current.title.toLowerCase()} (walls, doors and placing lights)`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="snap" size={14} className="snap-caption" />
        <span className="snap-value">{current.label}</span>
      </button>
      {open && (
        <ul className="menu-list tool-flyout snap-flyout" role="menu" aria-label="Snap to grid">
          {SNAPS.map((o) => (
            <li key={o.fraction} role="none">
              <button
                role="menuitemradio"
                aria-checked={o.fraction === snap}
                className={o.fraction === snap ? 'active' : ''}
                title={o.title}
                onClick={() => {
                  useGm.getState().setSnap(o.fraction)
                  setOpen(false)
                }}
              >
                {o.fraction === 0 ? 'No snap' : o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ToolButton(props: { icon: ReactNode; label: string; keyName: string; active: boolean; onClick(): void }) {
  return (
    <button
      className={`tool-button${props.active ? ' active' : ''}`}
      aria-pressed={props.active}
      aria-label={props.label}
      title={`${props.label} (${props.keyName})`}
      onClick={props.onClick}
    >
      {props.icon}
    </button>
  )
}
