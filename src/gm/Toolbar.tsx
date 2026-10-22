import { useEffect, useRef } from 'react'
import type { FogMode } from '../shared/types'
import { CurtainButton } from './Curtain'
import { toggleCurtain, useCurtain } from './curtainStore'
import { hideHandout, useHandouts } from './handoutStore'
import { SELECT } from './tools'
import { redo, undo } from './history'
import { newScene, openScene, saveScene } from './sceneFiles'
import { SettingsMenu } from './Settings'
import { SoundMixer } from './Sound'
import { useGm } from './store'
import { openTableWindow } from './tableWindow'
import { useDropdown } from './useDropdown'
import { Icon } from './icons'

export function Toolbar() {
  return (
    <header className="toolbar">
      <span className="toolbar-title">imagineVTT</span>
      {/* The scene */}
      <SceneFile />
      <UndoRedo />
      <span className="toolbar-divider" />
      {/* The table, live: what the players see right now */}
      <TableStatus />
      <PreviewButton />
      <CurtainButton />
      <AlertButton />
      <span className="toolbar-divider" />
      {/* Atmosphere */}
      <TimeOfDay />
      <ObscuringMenu />
      <ModeChips />
      <span className="toolbar-spacer" />
      <SoundMixer />
      <SettingsMenu />
    </header>
  )
}

/** The open scene's name (• when there are unsaved changes), and opening/saving files. */
function SceneFile() {
  const name = useGm((s) => s.sceneName) ?? 'Untitled scene'
  const unsaved = useGm((s) => s.unsaved)
  useEffect(() => {
    document.title = `${unsaved ? '• ' : ''}${name} — imagineVTT GM`
  }, [name, unsaved])
  return (
    <div className="toolbar-item scene-file">
      <span className="scene-name" title={unsaved ? 'Unsaved changes' : 'Saved'}>
        {name}
        {unsaved && <span className="unsaved-dot"> •</span>}
      </span>
      <button className="icon-button" title="New scene" onClick={newScene}>
        <Icon name="new" size={18} />
      </button>
      <button className="icon-button" title="Open a scene (Ctrl+O)" onClick={() => void openScene()}>
        <Icon name="open" size={18} />
      </button>
      <button
        className="icon-button"
        title="Save the scene (Ctrl+S; Ctrl+Shift+S to save as a new file)"
        onClick={(e) => void saveScene(e.shiftKey)}
      >
        <Icon name="save" size={18} />
      </button>
    </div>
  )
}

const FOG_MODES: { value: FogMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Players see the whole map.' },
  {
    value: 'dim',
    label: 'Dim',
    hint: 'Players see what vision tokens see; the rest of the map shows in greyscale. Nothing to explore.',
  },
  {
    value: 'full',
    label: 'Full (Fog of War)',
    hint: 'Fog of war: players see what vision tokens see, a greyscale memory of where they’ve been, and black elsewhere.',
  },
]

/**
 * Obscuring dropdown: what the players see beyond their vision (off, dimmed, fog of war),
 * forgetting what was explored, vision safety, and hidden areas on or off.
 */
function ObscuringMenu() {
  const mode = useGm((s) => s.scene.fog.mode)
  const safety = useGm((s) => s.scene.fog.safety)
  const hiddenOn = useGm((s) => s.scene.hiddenEnabled !== false)
  const hiddenCount = useGm((s) => s.scene.hiddenAreas?.length ?? 0)
  const { setFogMode, resetFog, setVisionSafety, setHiddenEnabled } = useGm.getState()
  const { open, setOpen, root } = useDropdown()
  const current = FOG_MODES.find((m) => m.value === mode)!
  return (
    <div className="menu" ref={root}>
      <button
        // One width whatever the setting, so the button (and its dropdown) stays put.
        className={`obscuring-button${mode !== 'off' ? ' active' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="What the players see: fog of war, vision safety and hidden areas (this floor)"
        onClick={() => setOpen(!open)}
      >
        <Icon name="fog" /> Obscuring: {current.label}
        {safety && mode !== 'off' && (
          <span title="Vision safety on">
            <Icon name="safety" size={14} />
          </span>
        )}
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="menu-list menu-right settings-panel" role="dialog" aria-label="Obscuring">
          <h2>Beyond the party’s sight</h2>
          <div className="segmented" role="radiogroup" aria-label="Fog of war">
            {FOG_MODES.map((m) => (
              <button
                key={m.value}
                role="radio"
                aria-checked={mode === m.value}
                className={mode === m.value ? 'active' : ''}
                onClick={() => setFogMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="hint">{current.hint}</p>
          <button
            disabled={mode !== 'full'}
            title={mode === 'full' ? undefined : 'Only Full (Fog of War) remembers explored areas'}
            onClick={() => {
              if (confirm('Forget everything the party has explored?')) resetFog()
            }}
          >
            <Icon name="reset-fog" /> Reset explored areas
          </button>
          <label className="check" title={mode === 'off' ? 'Only while something is out of sight (Dim or Full)' : undefined}>
            <input
              type="checkbox"
              checked={safety}
              disabled={mode === 'off'}
              onChange={(e) => setVisionSafety(e.target.checked)}
            />
            <Icon name="safety" /> Vision safety
          </label>
          <p className="hint">
            Vision tokens can’t be dragged through walls or closed doors, so a careless drag doesn’t reveal the
            next room. Hold <kbd>Alt</kbd> while dragging to go through anyway.
          </p>
          <label className="check">
            <input type="checkbox" checked={hiddenOn} onChange={(e) => setHiddenEnabled(e.target.checked)} />
            <Icon name="hide" /> Hidden areas{hiddenCount ? ` (${hiddenCount})` : ''}
          </label>
          <p className="hint">
            Unticked, all hidden areas on this floor are switched off, not removed. Each can also be switched off
            on its own: click its token.
          </p>
        </div>
      )}
    </div>
  )
}

/** Whether the table window is connected; opens it when it isn't. */
function TableStatus() {
  const connected = useGm((s) => s.tableConnected)
  return (
    <button
      className={`table-status${connected ? ' connected' : ''}`}
      title={connected ? 'Table window connected' : 'Table window not connected: click to open it'}
      onClick={openTableWindow}
    >
      <span className="status-dot" aria-hidden /> Table
    </button>
  )
}

/** Undo and redo buttons (Ctrl+Z, Ctrl+Y). */
function UndoRedo() {
  const { canUndo, canRedo } = useGm((s) => s.history)
  return (
    <div className="toolbar-item toolbar-group">
      <button className="icon-button" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <Icon name="undo" size={18} />
      </button>
      <button className="icon-button" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
        <Icon name="redo" size={18} />
      </button>
    </div>
  )
}

/**
 * How dark the GM's own view is, relative to the table: from exactly what the players see
 * to full day. Holding the eye button (or V) shows exactly what the players see.
 */
const TOOL_NAMES: Record<string, string> = {
  walls: 'Building walls',
  doors: 'Building doors',
  light: 'Placing lights',
  hide: 'Hiding areas',
  water: 'Painting water',
  measure: 'Measuring',
}

/**
 * What's on that changes how clicks work, or what the table shows, as chips: each one's ✕
 * turns it off. Easy to forget otherwise.
 */
function ModeChips() {
  const tool = useGm((s) => s.tool.kind)
  const alerting = useGm((s) => s.alerting)
  const curtainDown = useCurtain((s) => s.state.down)
  const showing = useHandouts((s) => !!s.shown)
  const chips: { key: string; label: string; title: string; off(): void }[] = []
  if (alerting) chips.push({ key: 'alert', label: 'Alert mode', title: 'Stop alerting', off: () => useGm.getState().setAlerting(false) })
  if (tool !== 'select' && TOOL_NAMES[tool])
    chips.push({ key: 'tool', label: TOOL_NAMES[tool], title: 'Put the tool down (Esc)', off: () => useGm.getState().setTool(SELECT) })
  if (curtainDown) chips.push({ key: 'curtain', label: 'Curtain down', title: 'Raise the curtain (C)', off: () => void toggleCurtain() })
  if (showing) chips.push({ key: 'handout', label: 'Showing a picture', title: 'Stop showing it', off: hideHandout })
  if (!chips.length) return null
  return (
    <div className="mode-chips">
      {chips.map((c) => (
        <span key={c.key} className={`mode-chip mode-${c.key}`}>
          {c.label}
          <button className="icon-button" title={c.title} aria-label={c.title} onClick={c.off}>
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
    </div>
  )
}

/** Hold to see the table exactly as the players do (or hold V): no GM-only marks. */
function PreviewButton() {
  const peeking = useGm((s) => s.peeking)
  const { setPeeking } = useGm.getState()
  return (
    <button
      className={`preview-button${peeking ? ' active' : ''}`}
      title="Hold to see exactly what the players see, without your marks (or hold V)"
      aria-pressed={peeking}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setPeeking(true)
      }}
      onPointerUp={() => setPeeking(false)}
      onPointerCancel={() => setPeeking(false)}
    >
      <Icon name="peek" /> Preview
    </button>
  )
}

/**
 * Time of day as one track with two knobs: the top one (pointing down) is the players'
 * darkness, the bottom one (pointing up) yours. Until you move yours it follows theirs (a
 * diamond: you see what they see); moved, it stays where you put it; double-clicked, it
 * follows theirs again.
 */
function TimeOfDay() {
  const darkness = useGm((s) => s.scene.darkness)
  const gmView = useGm((s) => s.gmView)
  const { setDarkness, setGmView } = useGm.getState()
  const gm = gmView ?? darkness
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef<'players' | 'gm' | null>(null)
  const at = (e: { clientX: number }) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }
  const setGm = (v: number) => setGmView(Math.min(1, Math.max(0, v)))
  const move = (which: 'players' | 'gm', v: number) => (which === 'players' ? setDarkness(v) : setGm(v))
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const word = (v: number) => (v === 0 ? 'day' : v === 1 ? 'night' : `${pct(v)} dark`)
  const key = (which: 'players' | 'gm') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const now = which === 'players' ? darkness : gm
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') move(which, now - step)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') move(which, now + step)
    else return
    e.preventDefault()
  }
  return (
    <div
      className="toolbar-item time-of-day"
      title={`Time of day. Player View (top knob): ${word(darkness)}, on the table too. GM View (bottom knob): ${word(gm)}, your screen only. ${gmView === null ? ' (following the players)' : ''} Double-click: top to day, bottom to follow the players again.`}
    >
      <span className="dual-labels" aria-hidden>
        <span>Player View</span>
        <span>GM View</span>
      </span>
      <Icon name="day" />
      <div
        ref={track}
        onDragStart={(e) => e.preventDefault()}
        className="dual-track"
        onPointerDown={(e) => {
          // No text selection or native drag (the browser's "not allowed" cursor).
          e.preventDefault()
          // The upper half moves the players' knob, the lower half yours.
          const r = e.currentTarget.getBoundingClientRect()
          const which = e.clientY < r.top + r.height / 2 ? 'players' : 'gm'
          dragging.current = which
          e.currentTarget.setPointerCapture(e.pointerId)
          move(which, at(e))
        }}
        onPointerMove={(e) => dragging.current && move(dragging.current, at(e))}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          if (e.clientY < r.top + r.height / 2) setDarkness(0)
          else setGmView(null)
        }}
      >
        <div className="dual-line" />
        <div className="dual-fill" style={{ width: pct(darkness) }} />
        <div
          className="dual-knob players"
          style={{ left: pct(darkness) }}
          role="slider"
          tabIndex={0}
          aria-label="Darkness for the players"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(darkness * 100)}
          aria-valuetext={word(darkness)}
          onKeyDown={key('players')}
        />
        <div
          className="dual-knob gm"
          style={{ left: pct(gm) }}
          role="slider"
          tabIndex={0}
          aria-label="Darkness you see"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(gm * 100)}
          aria-valuetext={word(gm)}
          onKeyDown={key('gm')}
        />
      </div>
      <Icon name="night" />
    </div>
  )
}

/** Alert mode: click the map (in the table view) to ring a spot for the players, with a ping. */
function AlertButton() {
  const alerting = useGm((s) => s.alerting)
  return (
    <button
      className={alerting ? 'active' : ''}
      aria-pressed={alerting}
      title={
        alerting
          ? 'Alert mode: click the map inside the table view to alert the players there. Right-click or Esc to stop'
          : 'Alert: click a spot on the map to draw the players\' eyes to it, with a ping'
      }
      onClick={() => useGm.getState().setAlerting(!alerting)}
    >
      <Icon name="alert" /> Alert
    </button>
  )
}
