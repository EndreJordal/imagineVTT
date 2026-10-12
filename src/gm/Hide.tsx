import { useGm } from './store'
import { SELECT, type HideTool } from './tools'
import { Icon } from './icons'
import { Slider } from './ui'

const MODES: { value: HideTool; label: string; title: string }[] = [
  { value: 'fill', label: 'Fill', title: 'Click inside a space closed in by walls and doors to hide all of it' },
  { value: 'brush', label: 'Brush', title: 'Paint over what to hide' },
  { value: 'erase', label: 'Erase', title: 'Paint over what to reveal' },
]

/**
 * Floating options while hiding areas ("local fog"): parts of the map black on the table
 * whatever the party sees, without blocking their sight past them.
 */
export function HideToolbox() {
  const tool = useGm((s) => (s.tool.kind === 'hide' ? s.tool.mode : null))
  const brush = useGm((s) => s.hideBrush)
  const anyHidden = useGm((s) => !!s.scene.hiddenAreas?.length)
  if (!tool) return null
  const { setTool, setHideBrush, revealAll } = useGm.getState()

  return (
    <aside className="light-panel wall-toolbox" aria-label="Hiding areas">
      <header>
        <span className="light-panel-title">
          <Icon name="hide" /> Hiding areas
        </span>
        <button className="icon-button" title="Stop hiding areas (Esc)" onClick={() => setTool(SELECT)}>
          <Icon name="close" />
        </button>
      </header>
      <div className="segmented" role="radiogroup" aria-label="Hide mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            role="radio"
            aria-checked={tool === m.value}
            className={tool === m.value ? 'active' : ''}
            title={m.title}
            onClick={() => setTool({ kind: 'hide', mode: m.value })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="hint">
        {tool === 'fill'
          ? 'Click inside a room closed in by walls and doors to hide it.'
          : tool === 'brush'
            ? 'Paint over what to hide: each stroke is an area, or adds to the one it starts on. Hold Alt to erase.'
            : 'Paint over what to reveal. Hold Alt to hide instead.'}
      </p>
      <Slider
        label="Brush"
        unit="sq"
        value={brush}
        fallback={1}
        min={0.25}
        max={6}
        step={0.25}
        disabled={tool === 'fill'}
        title="Brush radius, in squares"
        onChange={setHideBrush}
      />
      <p className="hint">
        Hidden areas are black on the table whatever the party sees, but don’t block sight past them. Click an
        area’s token to set it up.
      </p>
      <button
        disabled={!anyHidden}
        onClick={() => {
          if (confirm('Reveal every hidden area on this floor?')) revealAll()
        }}
      >
        Reveal all
      </button>
    </aside>
  )
}

/** Floating panel for the selected hidden area: its soft edges, revealing, removing. */
export function HiddenAreaPanel() {
  const area = useGm((s) => s.scene.hiddenAreas?.find((a) => a.id === s.selectedHiddenId))
  if (!area) return null
  const { selectHidden, updateHidden, removeHidden } = useGm.getState()

  return (
    <aside className="light-panel" aria-label="Hidden area">
      <header>
        <span className="light-panel-title">
          <Icon name="hide" /> Hidden area
        </span>
        <button className="icon-button" title="Close" onClick={() => selectHidden(null)}>
          <Icon name="close" />
        </button>
      </header>
      <Slider
        label="Soft edges"
        unit="sq"
        value={area.softness}
        fallback={0.3}
        min={0}
        max={2}
        step={0.05}
        title="How far the edges fade out, in squares (outwards: all of the area stays hidden)"
        onChange={(softness) => updateHidden(area.id, { softness })}
      />
      <label className="check" title="Revealed when a vision token walks into it">
        <input
          type="checkbox"
          checked={area.revealWithVision}
          onChange={(e) => updateHidden(area.id, { revealWithVision: e.target.checked })}
        />
        Reveal with vision
      </label>
      <p className="hint">
        {area.revealWithVision
          ? 'Revealed when a vision token walks in.'
          : 'Stays hidden until you remove it, whoever walks in.'}
      </p>
      <button onClick={() => removeHidden(area.id)}>Remove area hiding</button>
    </aside>
  )
}
