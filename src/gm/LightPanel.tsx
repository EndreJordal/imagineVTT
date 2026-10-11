import { useEffect, useRef, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { emitsLight, LIGHT_PRESETS, type Light } from '../shared/lights'
import { useGm } from './store'

/**
 * Floating panel for configuring the selected light(s). With several selected, a change
 * applies to all of them; settings that differ between them show as mixed.
 */
export function LightPanel() {
  const lights = useGm(
    useShallow((s) => s.scene.lights.filter((l) => s.selectedLightIds.includes(l.id))),
  )
  const darkness = useGm((s) => s.scene.darkness)
  if (lights.length === 0) return null

  const { updateLights, removeLights, selectLight } = useGm.getState()
  const ids = lights.map((l) => l.id)
  const set = (patch: Partial<Light> | ((l: Light) => Partial<Light>)) => updateLights(ids, patch)

  const handheld = lights.filter((l) => LIGHT_PRESETS[l.kind].handheld)
  // Pure vision tokens give no light, so light settings apply to the others only.
  const emitters = lights.filter(emitsLight)
  // Hand-held lights can see; vision tokens always do (they're nothing else).
  const canToggleVision = emitters.filter((l) => LIGHT_PRESETS[l.kind].handheld)
  const seeing = lights.filter((l) => l.vision)
  const range = common(seeing, (l) => l.visionRange)
  const fogOn = useGm.getState().scene.fog.enabled
  const directional = lights.filter((l) => LIGHT_PRESETS[l.kind].shape !== 'radial')
  const cones = lights.filter((l) => LIGHT_PRESETS[l.kind].shape === 'cone')
  // Settings only some lights have apply to just those.
  const only = (subset: Light[], patch: Partial<Light>) => (l: Light) =>
    subset.includes(l) ? patch : {}

  const radius = common(emitters, (l) => l.radius)
  const intensity = common(emitters, (l) => l.intensity)
  const color = common(emitters, (l) => l.color)
  const degrees = common(directional, (l) => Math.round(((((l.angle * 180) / Math.PI) % 360) + 360) % 360))
  const cone = common(cones, (l) => l.cone)
  const first = emitters[0] ?? lights[0]
  const single = lights.length === 1 ? LIGHT_PRESETS[first.kind] : null

  return (
    <aside className="light-panel" aria-label="Light settings">
      <header>
        <span className="light-panel-title">
          {single ? (
            <>
              {single.icon} {single.label}
              {single.handheld && <span title="Hand-held: meant to be moved"> ✋</span>}
            </>
          ) : (
            <>
              {[...new Set(lights.map((l) => LIGHT_PRESETS[l.kind].icon))].join('')} {lights.length} lights
              selected
            </>
          )}
        </span>
        <button className="icon-button" title="Close" onClick={() => selectLight(null)}>
          ✕
        </button>
      </header>

      {emitters.length > 0 && (
        <TriCheck label="Lit" values={emitters.map((l) => l.on)} onChange={(on) => set(only(emitters, { on }))} />
      )}
      {handheld.length > 0 && (
        <TriCheck
          label="Travel with the PVB"
          title="Moves along when you move the table view; you can still drag it"
          values={handheld.map((l) => !!l.followView)}
          onChange={(followView) => set(only(handheld, { followView }))}
        />
      )}
      {canToggleVision.length > 0 && (
        <TriCheck
          label="Vision"
          title="Breaks fog of war: the party sees from here"
          values={canToggleVision.map((l) => l.vision)}
          onChange={(vision) => set(only(canToggleVision, { vision }))}
        />
      )}
      {seeing.length > 0 && (
        <Row label={range === undefined ? 'Vision mixed' : `Vision ${range} sq`}>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={range ?? seeing[0].visionRange}
            onChange={(e) => set(only(seeing, { visionRange: e.target.valueAsNumber }))}
          />
        </Row>
      )}
      {seeing.length > 0 && !fogOn && <p className="hint">Vision shows once fog of war is on.</p>}
      {emitters.length > 0 && (
        <>
          <Row label={radius === undefined ? 'Radius mixed' : `Radius ${radius} sq`}>
            <input
              type="range"
              min={1}
              max={30}
              step={0.5}
              value={radius ?? first.radius}
              onChange={(e) => set(only(emitters, { radius: e.target.valueAsNumber }))}
            />
          </Row>
          <Row label={intensity === undefined ? 'Brightness mixed' : `Brightness ${Math.round(intensity * 100)}%`}>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={intensity ?? first.intensity}
              onChange={(e) => set(only(emitters, { intensity: e.target.valueAsNumber }))}
            />
          </Row>
          <Row label={color === undefined ? 'Colour mixed' : 'Colour'}>
            <input
              type="color"
              className="swatch"
              value={color ?? first.color}
              onChange={(e) => set(only(emitters, { color: e.target.value }))}
            />
          </Row>
        </>
      )}
      {directional.length > 0 && (
        <Row label={degrees === undefined ? 'Direction mixed' : `Direction ${degrees}°`}>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={degrees ?? 0}
            onChange={(e) => set(only(directional, { angle: (e.target.valueAsNumber * Math.PI) / 180 }))}
          />
        </Row>
      )}
      {cones.length > 0 && (
        <Row label={cone === undefined ? 'Beam width mixed' : `Beam width ${cone}°`}>
          <input
            type="range"
            min={15}
            max={120}
            step={5}
            value={cone ?? cones[0].cone}
            onChange={(e) => set(only(cones, { cone: e.target.valueAsNumber }))}
          />
        </Row>
      )}
      {darkness === 0 && emitters.length > 0 && (
        <p className="hint">It's day: lights show once you slide towards night.</p>
      )}
      {lights.length === 1 && <p className="hint">Ctrl-click other lights to edit several at once.</p>}
      <button onClick={() => removeLights(ids)}>
        {lights.length === 1 ? 'Remove light' : `Remove ${lights.length} lights`}
      </button>
    </aside>
  )
}

/** The value all items share, or undefined if they differ (or there are none). */
function common<T>(items: Light[], get: (l: Light) => T): T | undefined {
  if (items.length === 0) return undefined
  const v = get(items[0])
  return items.every((l) => get(l) === v) ? v : undefined
}

/** Checkbox that shows a dash when some, but not all, of the values are true. */
function TriCheck(props: {
  label: string
  title?: string
  values: boolean[]
  onChange(value: boolean): void
}) {
  const all = props.values.every(Boolean)
  const some = props.values.some(Boolean)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !all
  }, [some, all])
  return (
    <label className="check" title={props.title}>
      {/* A mixed box turns everything on; then a second click turns everything off. */}
      <input ref={ref} type="checkbox" checked={all} onChange={() => props.onChange(!all)} />
      {props.label}
    </label>
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
