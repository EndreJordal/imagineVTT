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
      <GmVision />
      <LightMenu />
    </header>
  )
}

/**
 * How dark the GM's own view is, relative to the table: from exactly what the players see
 * to full day. Holding the eye button (or V) shows exactly what the players see.
 */
function GmVision() {
  const vision = useGm((s) => s.gmVision)
  const peeking = useGm((s) => s.peeking)
  const { setGmVision, setPeeking } = useGm.getState()
  const label = vision === 0 ? "players' view" : vision === 1 ? 'day' : `${Math.round(vision * 100)}% lighter`
  return (
    <div className="toolbar-item" title="Your view only: how much of the night you see. The table is not affected.">
      <button
        className={`icon-button peek${peeking ? ' active' : ''}`}
        title="Hold (or hold V) to see exactly what the players see"
        aria-pressed={peeking}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setPeeking(true)
        }}
        onPointerUp={() => setPeeking(false)}
        onPointerCancel={() => setPeeking(false)}
      >
        👁
      </button>
      <span className="toolbar-label">GM vision</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={vision}
        aria-label="GM vision"
        aria-valuetext={label}
        onChange={(e) => setGmVision(e.target.valueAsNumber)}
      />
      <span className="toolbar-value">{label}</span>
    </div>
  )
}

/** Toolbar button with a dropdown of light sources; picking one lets the GM click to place it. */
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

  // Picking a light arms placement mode; the GM then clicks the map where it goes.
  const pick = (kind: LightKind) => {
    useGm.getState().setPlacingLight(kind)
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
                <button role="menuitem" onClick={() => pick(kind)}>
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
