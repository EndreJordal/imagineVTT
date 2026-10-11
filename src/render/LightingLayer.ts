import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js'
import { animateLight, LIGHT_PRESETS, seedOf, type Light } from '../shared/lights'
import type { Rect } from '../shared/types'
import { coneTexture, radialTexture } from './lightTextures'

/** Longest side of the light map; light is smooth, so a coarse map is plenty. */
const LIGHT_MAP_SIZE = 1536
/** How strongly a light tints what it lights, at full night. */
const GLOW = 0.32
/** A flashlight also spills a little light around whoever holds it. */
const SPILL_RADIUS = 0.22
const SPILL_BRIGHTNESS = 0.35
/** Neon tubes glow in an elongated shape this many times longer than wide. */
const TUBE_STRETCH = 2.6

interface LightSprites {
  /** White shape drawn into the light map (how much of the day-lit map shows through). */
  mask: Sprite
  /** Tinted shape added on top, colouring what the light falls on. */
  glow: Sprite
  /** Flashlight spill around the holder. */
  spillMask?: Sprite
  spillGlow?: Sprite
}

/**
 * Light from light sources at night. Each frame, lights are drawn (with their flicker) into a
 * low-resolution light map; the scene layer uses it as a mask over an undimmed copy of the
 * map, and the glow container adds each light's colour on top.
 */
export class LightingLayer {
  /** Scene-space sprite of the light map; the scene layer masks its lit copy with it. */
  readonly maskSprite = new Sprite()
  /** Add-blended light colour; the scene layer places it above the map. */
  readonly glow = new Container({ blendMode: 'add' })
  /** Clips the glow to the map: light falls on the map, not the void around it. */
  readonly glowClip = new Graphics()

  private maskRoot = new Container()
  private lightMap: RenderTexture | null = null
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private factor = 1
  private lights: Light[] = []
  private sprites = new Map<string, LightSprites>()
  private gridSize = 100
  private darkness = 0

  constructor() {
    this.glow.mask = this.glowClip
  }

  /** Whether anything is lit; the scene layer hides the lit copy otherwise. */
  get active() {
    return this.darkness > 0 && this.lights.some((l) => l.on)
  }

  sync(lights: Light[], bounds: Rect, gridSize: number, darkness: number) {
    this.lights = lights
    this.gridSize = gridSize
    this.darkness = darkness
    this.resize(bounds)

    const ids = new Set(lights.map((l) => l.id))
    for (const [id, s] of this.sprites) {
      if (ids.has(id)) continue
      for (const sprite of Object.values(s)) sprite?.destroy()
      this.sprites.delete(id)
    }
    for (const light of lights) {
      if (this.sprites.has(light.id)) continue
      const shape = LIGHT_PRESETS[light.kind].shape
      const tex = shape === 'cone' ? coneTexture() : radialTexture()
      const anchor = shape === 'cone' ? { x: 0, y: 0.5 } : { x: 0.5, y: 0.5 }
      const s: LightSprites = {
        mask: new Sprite({ texture: tex, anchor, blendMode: 'add' }),
        glow: new Sprite({ texture: tex, anchor }),
      }
      if (shape === 'cone') {
        s.spillMask = new Sprite({ texture: radialTexture(), anchor: 0.5, blendMode: 'add' })
        s.spillGlow = new Sprite({ texture: radialTexture(), anchor: 0.5 })
      }
      this.maskRoot.addChild(...[s.mask, s.spillMask].filter((x) => !!x))
      this.glow.addChild(...[s.glow, s.spillGlow].filter((x) => !!x))
      this.sprites.set(light.id, s)
    }
  }

  /** Redraw the light map for time t (seconds). */
  animate(renderer: Renderer, t: number) {
    if (!this.active || !this.lightMap) return
    for (const light of this.lights) {
      const s = this.sprites.get(light.id)!
      const preset = LIGHT_PRESETS[light.kind]
      const f = animateLight(preset.animation, t, seedOf(light.id))
      const radius = light.radius * this.gridSize * f.reach
      const x = light.x + f.dx * radius
      const y = light.y + f.dy * radius
      const brightness = light.on ? light.intensity * f.brightness : 0
      const glow = brightness * GLOW * this.darkness

      for (const [sprite, alpha] of [[s.mask, brightness], [s.glow, glow]] as const) {
        sprite.position.set(x, y)
        sprite.rotation = light.angle
        sprite.alpha = alpha
        if (preset.shape === 'cone') {
          const halfAngle = ((light.cone / 2) * Math.PI) / 180
          sprite.scale.set(radius / sprite.texture.width, (radius * Math.tan(halfAngle)) / (sprite.texture.height / 2))
        } else if (preset.shape === 'tube') {
          sprite.scale.set((radius * TUBE_STRETCH) / (sprite.texture.width / 2), radius / (sprite.texture.height / 2))
        } else {
          sprite.scale.set(radius / (sprite.texture.width / 2))
        }
      }
      s.glow.tint = light.color
      if (s.spillMask && s.spillGlow) {
        const r = radius * SPILL_RADIUS
        for (const [sprite, alpha] of [[s.spillMask, brightness * SPILL_BRIGHTNESS], [s.spillGlow, glow * SPILL_BRIGHTNESS]] as const) {
          sprite.position.set(x, y)
          sprite.alpha = alpha
          sprite.scale.set(r / (sprite.texture.width / 2))
        }
        s.spillGlow.tint = light.color
      }
    }
    this.maskRoot.position.set(-this.bounds.x / this.factor, -this.bounds.y / this.factor)
    this.maskRoot.scale.set(1 / this.factor)
    renderer.render({ container: this.maskRoot, target: this.lightMap, clear: true, clearColor: [0, 0, 0, 1] })
  }

  private resize(bounds: Rect) {
    const b = this.bounds
    if (b.x === bounds.x && b.y === bounds.y && b.width === bounds.width && b.height === bounds.height) return
    this.bounds = { ...bounds }
    this.factor = Math.max(1, Math.max(bounds.width, bounds.height) / LIGHT_MAP_SIZE)
    const width = Math.max(1, Math.ceil(bounds.width / this.factor))
    const height = Math.max(1, Math.ceil(bounds.height / this.factor))
    this.lightMap?.destroy(true)
    this.lightMap = RenderTexture.create({ width, height, resolution: 1 })
    this.maskSprite.texture = this.lightMap
    this.maskSprite.position.set(bounds.x, bounds.y)
    this.maskSprite.scale.set(this.factor)
    this.glowClip.clear().rect(bounds.x, bounds.y, bounds.width, bounds.height).fill(0xffffff)
  }
}
