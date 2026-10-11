import type { ReactNode } from 'react'
import { LIGHT_PRESETS } from '../shared/lights'
import { useGm } from './store'

/** Floating panel for configuring the selected light. */
export function LightPanel() {
  const light = useGm((s) => s.scene.lights.find((l) => l.id === s.selectedLightId))
  const darkness = useGm((s) => s.scene.darkness)
  const { updateLight, removeLight, selectLight } = useGm.getState()
  if (!light) return null

  const preset = LIGHT_PRESETS[light.kind]
  const set = (patch: Parameters<typeof updateLight>[1]) => updateLight(light.id, patch)
  const degrees = Math.round((((light.angle * 180) / Math.PI) % 360 + 360) % 360)

  return (
    <aside className="light-panel" aria-label="Light settings">
      <header>
        <span className="light-panel-title">
          {preset.icon} {preset.label}
          {preset.handheld && <span title="Hand-held: meant to be moved"> ✋</span>}
        </span>
        <button className="icon-button" title="Close" onClick={() => selectLight(null)}>
          ✕
        </button>
      </header>

      <label className="check">
        <input type="checkbox" checked={light.on} onChange={(e) => set({ on: e.target.checked })} />
        Lit
      </label>
      <Row label={`Radius ${light.radius} sq`}>
        <input
          type="range"
          min={1}
          max={30}
          step={0.5}
          value={light.radius}
          onChange={(e) => set({ radius: e.target.valueAsNumber })}
        />
      </Row>
      <Row label={`Brightness ${Math.round(light.intensity * 100)}%`}>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={light.intensity}
          onChange={(e) => set({ intensity: e.target.valueAsNumber })}
        />
      </Row>
      <Row label="Colour">
        <input type="color" className="swatch" value={light.color} onChange={(e) => set({ color: e.target.value })} />
      </Row>
      {preset.shape !== 'radial' && (
        <Row label={`Direction ${degrees}°`}>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={degrees}
            onChange={(e) => set({ angle: (e.target.valueAsNumber * Math.PI) / 180 })}
          />
        </Row>
      )}
      {preset.shape === 'cone' && (
        <Row label={`Beam width ${light.cone}°`}>
          <input
            type="range"
            min={15}
            max={120}
            step={5}
            value={light.cone}
            onChange={(e) => set({ cone: e.target.valueAsNumber })}
          />
        </Row>
      )}
      {darkness === 0 && <p className="hint">It's day: lights show once you slide towards night.</p>}
      <button onClick={() => removeLight(light.id)}>Remove light</button>
    </aside>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}
