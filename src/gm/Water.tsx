import { useGm } from './store'
import { SELECT } from './tools'
import { Icon } from './icons'
import { SoundPicker } from './Sound'
import { Slider } from './ui'
import type { WaterTool } from './slices/water'

const MODES: { value: WaterTool; label: string; title: string }[] = [
  { value: 'brush', label: 'Brush', title: 'Paint water over the map' },
  { value: 'erase', label: 'Erase', title: 'Paint over water to take it away' },
  { value: 'fill', label: 'Fill', title: 'Click inside a space closed in by walls to fill all of it' },
]

/** Floating options while painting water. */
export function WaterToolbox() {
  const tool = useGm((s) => (s.tool.kind === 'water' ? s.tool.mode : null))
  const brush = useGm((s) => s.waterBrush)
  if (!tool) return null
  const { setTool, setWaterBrush } = useGm.getState()
  return (
    <aside className="light-panel wall-toolbox" aria-label="Painting water">
      <header>
        <span className="light-panel-title">
          <Icon name="water" /> Water
        </span>
        <button className="icon-button" title="Stop painting water (Esc)" onClick={() => setTool(SELECT)}>
          <Icon name="close" />
        </button>
      </header>
      <div className="segmented" role="radiogroup" aria-label="Water mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            role="radio"
            aria-checked={tool === m.value}
            className={tool === m.value ? 'active' : ''}
            title={m.title}
            onClick={() => setTool({ kind: 'water', mode: m.value })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="hint">
        {tool === 'fill'
          ? 'Click inside a pool or basin closed in by walls to fill it with water.'
          : tool === 'brush'
            ? 'Paint over the map’s water: a stroke starting on water adds to it (one token); elsewhere it starts new water. Hold Alt to erase.'
            : 'Paint over water to take it away. Hold Alt to paint instead.'}
      </p>
      <Slider
        label="Brush"
        unit="sq"
        value={brush}
        fallback={1}
        min={0.1}
        max={6}
        step={0.05}
        disabled={tool === 'fill'}
        title="Brush radius, in squares"
        onChange={setWaterBrush}
      />
      <p className="hint">Blue shows you where water is; the players see only the water moving. Click its token to set it up.</p>
    </aside>
  )
}

/**
 * Floating panel for the selected water: how it moves, its colour, edges and sound. With
 * several selected, a change sets them all (a value they don't share shows as mixed).
 */
export function WaterPanel() {
  const ids = useGm((s) => s.selectedWaterIds)
  const all = useGm((s) => s.scene.waterAreas)
  const areas = (all ?? []).filter((a) => ids.includes(a.id))
  if (!areas.length) return null
  const { selectWater, updateWaters, removeWater } = useGm.getState()
  const one = areas.length === 1 ? areas[0] : null
  const set = (patch: Parameters<typeof updateWaters>[1]) => updateWaters(areas.map((a) => a.id), patch)
  /** The selection's shared value (undefined: mixed). */
  const shared = <K extends keyof (typeof areas)[number]>(key: K) =>
    areas.every((a) => a[key] === areas[0][key]) ? areas[0][key] : undefined
  const num = (key: 'ripple' | 'waves' | 'flow' | 'direction' | 'softness' | 'tint') => shared(key) as number | undefined
  const active = areas.every((a) => a.active !== false)
  const sound = one?.sound
  return (
    <aside className="light-panel" aria-label="Water">
      <header>
        <span className="light-panel-title">
          <Icon name="water" /> {one ? one.name : `${areas.length} water areas`}
        </span>
        <button className="icon-button" title="Close" onClick={() => selectWater(null)}>
          <Icon name="close" />
        </button>
      </header>
      <label className="check" title="Switched off, the water is kept but still">
        <input type="checkbox" checked={active} onChange={(e) => set({ active: e.target.checked })} />
        Active
      </label>
      <Slider label="Ripple" unit="%" scale={100} value={num('ripple')} fallback={0.5} min={0} max={1} step={0.05}
        title="Small ripples bending the picture, with moving light" onChange={(ripple) => set({ ripple })} />
      <Slider label="Waves" unit="%" scale={100} value={num('waves')} fallback={0.2} min={0} max={1} step={0.05}
        title="Slow, larger swells with soft bright crests" onChange={(waves) => set({ waves })} />
      <Slider label="Flow" unit="%" scale={100} value={num('flow')} fallback={0} min={0} max={1} step={0.05}
        title="How fast the water moves one way (0: still)" onChange={(flow) => set({ flow })} />
      <Slider label="Flow direction" unit="°" value={num('direction')} fallback={0} min={0} max={359} step={1}
        disabled={num('flow') === 0} title="Which way it flows: 0° right, 90° down, 180° left, 270° up"
        onChange={(direction) => set({ direction })} />
      <Slider label="Edge softness" unit="sq" value={num('softness')} fallback={0.5} min={0} max={3} step={0.05}
        title="How far the edges blend into the map, in squares" onChange={(softness) => set({ softness })} />
      <div className="row">
        <span className="slider-label">Colour{shared('color') === undefined ? ' (mixed)' : ''}</span>
        <input type="color" className="swatch" value={(shared('color') as string | undefined) ?? areas[0].color}
          title="The colour the water takes on" onChange={(e) => set({ color: e.target.value })} />
      </div>
      <Slider label="Colour strength" unit="%" scale={100} value={num('tint')} fallback={0} min={0} max={1} step={0.05}
        title="How much of the colour the players see (0: the map's own water)" onChange={(tint) => set({ tint })} />

      {one ? (
        <>
          <SoundPicker
            label="Sound"
            value={sound?.clip ?? null}
            onChange={(clip) => set({ sound: clip ? { clip, volume: sound?.volume ?? 0.6, range: sound?.range ?? 6 } : null })}
          />
          {sound && (
            <>
              <Slider label="Volume" unit="%" scale={100} value={sound.volume} fallback={0.6} min={0} max={1} step={0.05}
                title="How loud beside the water" onChange={(volume) => set({ sound: { ...sound, volume } })} />
              <Slider label="Heard within" unit="sq" value={sound.range} fallback={6} min={1} max={40} step={1}
                title="How far from the water's edge it's heard (silent beyond)"
                onChange={(range) => set({ sound: { ...sound, range } })} />
              <p className="hint">Loops, loudest beside any part of the water, fading out with distance from its edge.</p>
            </>
          )}
        </>
      ) : (
        <p className="hint">Select one water area to set its sound.</p>
      )}
      <button onClick={() => areas.forEach((a) => removeWater(a.id))}>
        {one ? 'Remove water' : `Remove ${areas.length} water areas`}
      </button>
    </aside>
  )
}
