import { useEffect } from 'react'
import { redo, undo } from './history'
import { newScene, openScene, saveScene } from './sceneFiles'
import { SettingsMenu } from './Settings'
import { useGm } from './store'
import { openTableWindow } from './tableWindow'
import { useDropdown } from './useDropdown'

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
      <FogMenu />
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
        📄
      </button>
      <button className="icon-button" title="Open a scene (Ctrl+O)" onClick={() => void openScene()}>
        📂
      </button>
      <button
        className="icon-button"
        title="Save the scene (Ctrl+S; Ctrl+Shift+S to save as a new file)"
        onClick={(e) => void saveScene(e.shiftKey)}
      >
        💾
      </button>
    </div>
  )
}

/** Fog dropdown: fog of war on/off, forgetting what was explored, and vision safety. */
function FogMenu() {
  const enabled = useGm((s) => s.scene.fog.enabled)
  const safety = useGm((s) => s.scene.fog.safety)
  const { setFogEnabled, resetFog, setVisionSafety } = useGm.getState()
  const { open, setOpen, root } = useDropdown()
  return (
    <div className="menu" ref={root}>
      <button
        className={enabled ? 'active' : ''}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Fog of war and vision safety"
        onClick={() => setOpen(!open)}
      >
        🌫 Fog {enabled ? 'on' : 'off'}
        {safety && <span title="Vision safety on"> 🛡</span>} ▾
      </button>
      {open && (
        <div className="menu-list menu-right settings-panel" role="dialog" aria-label="Fog of war">
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(e) => setFogEnabled(e.target.checked)} />
            Fog of war
          </label>
          <p className="hint">
            Players see only what vision tokens see, and a greyscale memory of where they’ve been.
          </p>
          <button
            disabled={!enabled}
            onClick={() => {
              if (confirm('Forget everything the party has explored?')) resetFog()
            }}
          >
            ↺ Reset explored areas
          </button>
          <label className="check">
            <input type="checkbox" checked={safety} onChange={(e) => setVisionSafety(e.target.checked)} />
            🛡 Vision safety
          </label>
          <p className="hint">
            Vision tokens can’t be dragged through walls or closed doors, so a careless drag doesn’t reveal the
            next room. Hold <kbd>Alt</kbd> while dragging to go through anyway.
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
        ↶
      </button>
      <button className="icon-button" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>
        ↷
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
