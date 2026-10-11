import { DEFAULT_HIDDEN_SOFTNESS } from '../shared/hidden'
import { useGm, type HideTool } from './store'
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
  const tool = useGm((s) => s.hideTool)
  const brush = useGm((s) => s.hideBrush)
  const softness = useGm((s) => s.scene.hiddenSoftness ?? DEFAULT_HIDDEN_SOFTNESS)
  const anyHidden = useGm((s) => !!s.scene.hidden)
  if (!tool) return null
  const { setHideTool, setHideBrush, setHiddenSoftness, revealAll } = useGm.getState()

  return (
    <aside className="light-panel wall-toolbox" aria-label="Hiding areas">
      <header>
        <span className="light-panel-title">
          <Icon name="hide" /> Hiding areas
        </span>
        <button className="icon-button" title="Stop hiding areas (Esc)" onClick={() => setHideTool(null)}>
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
            onClick={() => setHideTool(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="hint">
        {tool === 'fill'
          ? 'Click inside a room closed in by walls and doors to hide it. Click a hidden area to reveal it.'
          : tool === 'brush'
            ? 'Paint over what to hide. Hold Alt to erase instead.'
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
      <Slider
        label="Soft edges"
        unit="sq"
        value={softness}
        fallback={DEFAULT_HIDDEN_SOFTNESS}
        min={0}
        max={2}
        step={0.05}
        title="How far hidden areas fade out at their edges, in squares"
        onChange={setHiddenSoftness}
      />
      <p className="hint">
        Hidden areas are black on the table whatever the party sees, but don’t block sight past them. You see
        them shaded purple.
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
