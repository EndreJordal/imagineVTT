import { useEffect, useRef, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { emitsLight, flickerOf, isDirectional, LIGHT_PRESETS, type Flicker, type Light } from '../shared/lights'
import { useGm } from './store'
import { Slider } from './ui'
import { Icon, LightKindIcon } from './icons'

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
  // Hand-held lights and vision tokens can see; the range can be set before switching on.
  const canSee = lights.filter((l) => LIGHT_PRESETS[l.kind].handheld)
  const seeing = canSee.filter((l) => l.vision)
  const range = common(canSee, (l) => l.visionRange)
  const fogOn = useGm.getState().scene.fog.enabled
  const directional = lights.filter(isDirectional)
  const cones = lights.filter((l) => LIGHT_PRESETS[l.kind].shape === 'cone')
  const flickering = lights.filter((l) => !!flickerOf(l))
  const fl = (l: Light) => flickerOf(l)!
  // Change one part of each flickering light's settings, keeping the rest of its own.
  const setFlicker = (change: (f: Flicker) => Flicker) =>
    set((l) => (flickering.includes(l) ? { flicker: change(fl(l)) } : {}))
  const rate = common(flickering, (l) => fl(l).rate)
  const lowLevel = common(flickering, (l) => fl(l).low.level)
  const highBoost = common(flickering, (l) => fl(l).high.boost)
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
              <LightKindIcon icon={single.icon} /> {single.label}
              {single.handheld && (
                <span title="Hand-held: meant to be moved">
                  {' '}
                  <Icon name="hand-held" size={14} />
                </span>
              )}
            </>
          ) : (
            <>
              {[...new Set(lights.map((l) => LIGHT_PRESETS[l.kind].icon))].map((icon) => (
                <LightKindIcon key={icon} icon={icon} />
              ))}{' '}
              {lights.length} lights selected
            </>
          )}
        </span>
        <button className="icon-button" title="Close" onClick={() => selectLight(null)}>
          <Icon name="close" />
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
      {canSee.length > 0 && (
        <TriCheck
          label="Vision"
          title="Breaks fog of war: the party sees from here"
          values={canSee.map((l) => l.vision)}
          onChange={(vision) => set(only(canSee, { vision }))}
        />
      )}
      {canSee.length > 0 && (
        <Slider
          label="Vision range"
          unit="sq"
          value={range}
          fallback={canSee[0].visionRange}
          min={1}
          max={100}
          step={1}
          onChange={(visionRange) => set(only(canSee, { visionRange }))}
        />
      )}
      {seeing.length > 0 && !fogOn && <p className="hint">Vision shows once fog of war is on.</p>}
      {emitters.length > 0 && (
        <>
          <Slider
            label="Radius"
            unit="sq"
            value={radius}
            fallback={first.radius}
            min={1}
            max={30}
            step={0.5}
            onChange={(radius) => set(only(emitters, { radius }))}
          />
          <Slider
            label="Brightness"
            unit="%"
            scale={100}
            value={intensity}
            fallback={first.intensity}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(intensity) => set(only(emitters, { intensity }))}
          />
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
        <Slider
          label="Direction"
          unit="°"
          value={degrees}
          fallback={0}
          min={0}
          max={359}
          step={1}
          onChange={(deg) => set(only(directional, { angle: (deg * Math.PI) / 180 }))}
        />
      )}
      {flickering.length > 0 && (
        <div className="panel-group">
          <h3>Flicker</h3>
          <Slider
            label="Rate"
            unit="/min"
            value={rate}
            fallback={fl(flickering[0]).rate}
            min={1}
            max={120}
            step={1}
            onChange={(rate) => setFlicker((f) => ({ ...f, rate }))}
          />
          <TriCheck
            label="Flicker down"
            title="Dips: the light drops to this brightness"
            values={flickering.map((l) => fl(l).low.on)}
            onChange={(on) => setFlicker((f) => ({ ...f, low: { ...f.low, on } }))}
          />
          <Slider
            label="Down to"
            unit="%"
            scale={100}
            value={lowLevel}
            fallback={fl(flickering[0]).low.level}
            min={0}
            max={1}
            step={0.05}
            disabled={!flickering.some((l) => fl(l).low.on)}
            onChange={(level) => setFlicker((f) => ({ ...f, low: { ...f.low, level } }))}
          />
          <TriCheck
            label="Flicker up"
            title="Surges: this much is added to the brightness"
            values={flickering.map((l) => fl(l).high.on)}
            onChange={(on) => setFlicker((f) => ({ ...f, high: { ...f.high, on } }))}
          />
          <Slider
            label="Up by +"
            unit="%"
            scale={100}
            value={highBoost}
            fallback={fl(flickering[0]).high.boost}
            min={0}
            max={1}
            step={0.05}
            disabled={!flickering.some((l) => fl(l).high.on)}
            onChange={(boost) => setFlicker((f) => ({ ...f, high: { ...f.high, boost } }))}
          />
        </div>
      )}
      {cones.length > 0 && (
        <Slider
          label="Beam width"
          unit="°"
          value={cone}
          fallback={cones[0].cone}
          min={15}
          max={120}
          step={5}
          onChange={(cone) => set(only(cones, { cone }))}
        />
      )}
      {darkness === 0 && emitters.length > 0 && (
        <p className="hint">It's day: lights show once you slide towards night.</p>
      )}
      {lights.length === 1 && (
        <p className="hint">Ctrl-click other lights, or Shift-drag a box, to edit several at once.</p>
      )}
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
