import { useEffect, useRef, useState } from 'react'
import { LIGHT_MENU, LIGHT_PRESETS, type LightKind } from '../shared/lights'
import { useGm } from './store'

export function Toolbar() {
  const darkness = useGm((s) => s.scene.darkness)
  const setDarkness = useGm((s) => s.setDarkness)

  return (
    <header className="toolbar">
      <span className="toolbar-title">imagineVTT</span>
      <label className="toolbar-item" title="Time of day: dims and desaturates the map, on the table too">
        <span aria-hidden>☀</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={darkness}
          aria-label="Time of day"
          aria-valuetext={darkness === 0 ? 'Day' : darkness === 1 ? 'Night' : `${Math.round(darkness * 100)}% dark`}
          onChange={(e) => setDarkness(e.target.valueAsNumber)}
          onDoubleClick={() => setDarkness(0)}
        />
        <span aria-hidden>🌙</span>
      </label>
      <LightMenu />
    </header>
  )
}

/** Toolbar button with a dropdown of light sources; picking one places it in the table view. */
function LightMenu() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const add = (kind: LightKind) => {
    const { addLight, scene } = useGm.getState()
    addLight(kind, scene.view) // centre of what the table shows
    setOpen(false)
  }

  return (
    <div className="menu" ref={root}>
      <button
        className={open ? 'active' : ''}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add a light source"
        onClick={() => setOpen(!open)}
      >
        💡 Lights ▾
      </button>
      {open && (
        <ul className="menu-list" role="menu">
          {LIGHT_MENU.map(({ kind, label }) => {
            const p = LIGHT_PRESETS[kind]
            return (
              <li key={kind} role="none">
                <button role="menuitem" onClick={() => add(kind)}>
                  <span className="menu-icon" aria-hidden>
                    {p.icon}
                  </span>
                  <span className="menu-label">{label}</span>
                  {p.handheld && (
                    <span className="menu-badge" title="Hand-held: meant to be moved">
                      ✋
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
