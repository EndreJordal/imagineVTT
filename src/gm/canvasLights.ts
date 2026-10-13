/** Light and vision tokens (GM-only): ringed in the light's colour, with aim handle and vision rings. */
import { Graphics } from 'pixi.js'
import { emitsLight, isDirectional, LIGHT_PRESETS, type Light } from '../shared/lights'
import type { Point, Scene } from '../shared/types'
import { SLACK_PX, TOKEN_PX } from './canvasStyle'
import { drawToken, iconToken, onToken, TokenPool } from './canvasTokens'
import type { Target } from './canvasTypes'

/** How far out a directional light's aim handle sits, and its radius, in GM screen px. */
const AIM_PX = 44
const AIM_HANDLE_PX = 6

/** The selected light, if exactly one is selected. */
function soleSelected(lights: Light[], selected: Set<string>): Light | undefined {
  if (selected.size !== 1) return undefined
  const [id] = selected
  return lights.find((l) => l.id === id)
}

function aimPoint(light: Light, px: number): Point {
  const d = AIM_PX * px
  return { x: light.x + Math.cos(light.angle) * d, y: light.y + Math.sin(light.angle) * d }
}

export class LightTokens {
  private pool = new TokenPool(iconToken)
  readonly layer = this.pool.layer
  /** Faint rings showing how far the selected vision tokens see. */
  readonly rings = new Graphics()
  readonly aim = new Graphics()

  /** `ghosts`: lights only visiting (the party, on a floor being prepared), drawn faintly. */
  draw(scene: Scene, selected: Set<string>, ghosts: Set<string>, px: number) {
    const lights = scene.lights
    this.pool.keep(lights.map((l) => l.id))
    for (const light of lights) {
      const t = this.pool.get(light.id)
      drawToken(t, light, px, LIGHT_PRESETS[light.kind].icon, light.color, selected.has(light.id))
      // Dimmed when switched off: lights by being unlit, vision tokens by not seeing.
      const lit = emitsLight(light) ? light.on : light.vision
      t.root.alpha = (lit ? 1 : 0.55) * (ghosts.has(light.id) ? 0.5 : 1)
    }

    const rings = this.rings.clear()
    for (const light of lights) {
      if (!light.vision || !selected.has(light.id)) continue
      rings.circle(light.x, light.y, light.visionRange * scene.grid.size).stroke({ width: 1.5 * px, color: 0x9ad0ff, alpha: 0.5 })
    }

    // Aim handle for the selected directional light (when it's the only one selected).
    const g = this.aim.clear()
    const sole = soleSelected(lights, selected)
    if (sole && isDirectional(sole)) {
      const a = aimPoint(sole, px)
      const r = TOKEN_PX * px
      g.moveTo(sole.x + Math.cos(sole.angle) * r, sole.y + Math.sin(sole.angle) * r)
        .lineTo(a.x, a.y)
        .stroke({ width: 2 * px, color: 0xffffff, alpha: 0.8 })
      g.circle(a.x, a.y, AIM_HANDLE_PX * px).fill(0xffffff).stroke({ width: 1.5 * px, color: 0x000000 })
    }
  }

  /** The aim handle, then the topmost light at p (visiting ones can't be picked up). */
  hit(p: Point, lights: Light[], selected: Set<string>, ghosts: Set<string>, px: number): Target {
    const sole = soleSelected(lights, selected)
    if (sole && isDirectional(sole)) {
      const a = aimPoint(sole, px)
      if (Math.hypot(p.x - a.x, p.y - a.y) <= (AIM_HANDLE_PX + SLACK_PX) * px) return { kind: 'aim', id: sole.id }
    }
    const light = lights.findLast((l) => !ghosts.has(l.id) && onToken(p, l, px))
    return light ? { kind: 'light', id: light.id } : null
  }
}
