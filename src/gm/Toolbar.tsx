import { useEffect } from 'react'
import type { FogMode } from '../shared/types'
import { CurtainButton } from './Curtain'
import { redo, undo } from './history'
import { newScene, openScene, saveScene } from './sceneFiles'
import { SettingsMenu } from './Settings'
import { SoundMixer } from './Sound'
import { useGm } from './store'
import { openTableWindow } from './tableWindow'
import { useDropdown } from './useDropdown'
import { Icon } from './icons'

export function Toolbar() {
  const darkness = useGm((s) => s.scene.darkness)
  const setDarkness = useGm((s) => s.setDarkness)

  return (
    <header className="toolbar">
      <span className="toolbar-title">imagineVTT</span>
      <SceneFile />
      <UndoRedo />
      <TableStatus />
      <label className="toolbar-item" title="Time of day: dims and desaturates the map, on the table too">
        <Icon name="day" />
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
        <Icon name="night" />
      </label>
      <GmVision />
      <ObscuringMenu />
      <SoundMixer />
      <CurtainButton />
      <AlertButton />
      <span className="toolbar-spacer" />
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
        <Icon name="peek" size={18} />
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
