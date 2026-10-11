import { Container, RenderTexture, Sprite, type Renderer } from 'pixi.js'
import { animateLight, emitsLight, LIGHT_PRESETS, seedOf, type Light, type LightFrame } from '../shared/lights'
import type { Rect } from '../shared/types'
import { coneTexture, radialTexture } from './lightTextures'

/**
 * Longest side of the light maps. Light is smooth, so a coarse map is plenty: drawing many
 * overlapping lights here instead of at screen resolution is what keeps lights cheap.
 */
const LIGHT_MAP_SIZE = 1024
/** How strongly a light tints what it lights, at full night. */
const GLOW = 0.32
/** A flashlight also spills a little light around whoever holds it. */
const SPILL_RADIUS = 0.22
const SPILL_BRIGHTNESS = 0.35
/** Neon tubes glow in an elongated shape this many times longer than wide. */
const TUBE_STRETCH = 2.6

interface LightSprites {
  /** White shape in the mask map: how much of the day-lit map shows through. */
  mask: Sprite
  /** Tinted shape in the colour map: the light's colour on what it falls on. */
  glow: Sprite
  /** Flashlight spill around the holder. */
  spillMask?: Sprite
  spillGlow?: Sprite
}

/**
 * Light from light sources at night. Lights are drawn (with their flicker) into two
 * low-resolution maps covering the scene: a white mask map, which the scene layer uses to
 * reveal an undimmed copy of the map, and a colour map added on top. However many lights
 * there are, the screen-resolution cost is those two layers.
 *
 * The maps are only redrawn when something changed or a light is animated.
 */
export class LightingLayer {
  /** Scene-space sprite of the mask map; the scene layer masks its lit copy with it. */
  readonly maskSprite = new Sprite()
  /** Scene-space sprite of the colour map, add-blended above the map. */
  readonly glowSprite = new Sprite({ blendMode: 'add' })

  private maskRoot = new Container()
  private glowRoot = new Container()
  private maskMap: RenderTexture | null = null
  private glowMap: RenderTexture | null = null
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private factor = 1
  private lights: Light[] = []
  private sprites = new Map<string, LightSprites>()
  private gridSize = 100
  private darkness = 0
  /** Something changed since the maps were last drawn. */
  private dirty = true

  /** Whether anything is lit; the scene layer hides the lit copy otherwise. */
  get active() {
    return this.darkness > 0 && this.lights.some((l) => l.on && emitsLight(l))
  }

  sync(all: Light[], bounds: Rect, gridSize: number, darkness: number) {
    const lights = all.filter(emitsLight) // vision tokens give no light
    if (!sameLights(lights, this.lights) || gridSize !== this.gridSize || darkness !== this.darkness) {
      this.dirty = true
    }
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
      const texture = shape === 'cone' ? coneTexture() : radialTexture()
      const anchor = shape === 'cone' ? { x: 0, y: 0.5 } : { x: 0.5, y: 0.5 }
      const s: LightSprites = {
        mask: new Sprite({ texture, anchor, blendMode: 'add' }),
        glow: new Sprite({ texture, anchor, blendMode: 'add' }),
      }
      this.maskRoot.addChild(s.mask)
      this.glowRoot.addChild(s.glow)
      if (shape === 'cone') {
        s.spillMask = new Sprite({ texture: radialTexture(), anchor: 0.5, blendMode: 'add' })
        s.spillGlow = new Sprite({ texture: radialTexture(), anchor: 0.5, blendMode: 'add' })
        this.maskRoot.addChild(s.spillMask)
        this.glowRoot.addChild(s.spillGlow)
      }
      this.sprites.set(light.id, s)
    }
  }

  /** Redraw the light maps for time t (seconds), if anything changed or flickers. */
  animate(renderer: Renderer, t: number) {
    if (!this.active || !this.maskMap || !this.glowMap) return
    const animated = this.lights.some((l) => l.on && LIGHT_PRESETS[l.kind].animation !== 'steady')
    if (!this.dirty && !animated) return
    this.dirty = false

    for (const light of this.lights) {
      this.place(light, animateLight(LIGHT_PRESETS[light.kind].animation, t, seedOf(light.id)))
    }
    for (const [root, target] of [
      [this.maskRoot, this.maskMap],
      [this.glowRoot, this.glowMap],
    ] as const) {
      root.position.set(-this.bounds.x / this.factor, -this.bounds.y / this.factor)
      root.scale.set(1 / this.factor)
      renderer.render({ container: root, target, clear: true, clearColor: [0, 0, 0, 1] })
    }
  }

  /** Position, size and brighten one light's sprites for this frame. */
  private place(light: Light, f: LightFrame) {
    const s = this.sprites.get(light.id)!
    const shape = LIGHT_PRESETS[light.kind].shape
    const radius = light.radius * this.gridSize * f.reach
    const x = light.x + f.dx * radius
    const y = light.y + f.dy * radius
    const brightness = light.on ? light.intensity * f.brightness : 0
    const glow = brightness * GLOW * this.darkness

    let sx: number
    let sy: number
    const tex = s.mask.texture
    if (shape === 'cone') {
      const halfAngle = ((light.cone / 2) * Math.PI) / 180
      sx = radius / tex.width
      sy = (radius * Math.tan(halfAngle)) / (tex.height / 2)
    } else if (shape === 'tube') {
      sx = (radius * TUBE_STRETCH) / (tex.width / 2)
      sy = radius / (tex.height / 2)
    } else {
      sx = sy = radius / (tex.width / 2)
    }
    setSprite(s.mask, x, y, light.angle, sx, sy, brightness)
    setSprite(s.glow, x, y, light.angle, sx, sy, glow)
    s.glow.tint = light.color

    if (s.spillMask && s.spillGlow) {
      const spill = (radius * SPILL_RADIUS) / (s.spillMask.texture.width / 2)
      setSprite(s.spillMask, x, y, 0, spill, spill, brightness * SPILL_BRIGHTNESS)
      setSprite(s.spillGlow, x, y, 0, spill, spill, glow * SPILL_BRIGHTNESS)
      s.spillGlow.tint = light.color
    }
  }

  /** Fit the light maps to the scene bounds; resized in place, not reallocated. */
  private resize(bounds: Rect) {
    const b = this.bounds
    if (b.x === bounds.x && b.y === bounds.y && b.width === bounds.width && b.height === bounds.height) return
    this.bounds = { ...bounds }
    this.dirty = true
    this.factor = Math.max(1, Math.max(bounds.width, bounds.height) / LIGHT_MAP_SIZE)
    const width = Math.max(1, Math.ceil(bounds.width / this.factor))
    const height = Math.max(1, Math.ceil(bounds.height / this.factor))
    if (!this.maskMap || !this.glowMap) {
      this.maskMap = RenderTexture.create({ width, height, resolution: 1 })
      this.glowMap = RenderTexture.create({ width, height, resolution: 1 })
      this.maskSprite.texture = this.maskMap
      this.glowSprite.texture = this.glowMap
    } else {
      this.maskMap.source.resize(width, height)
      this.glowMap.source.resize(width, height)
    }
    for (const sprite of [this.maskSprite, this.glowSprite]) {
      sprite.position.set(bounds.x, bounds.y)
      sprite.scale.set(this.factor)
    }
  }

  destroy() {
    this.maskRoot.destroy({ children: true })
    this.glowRoot.destroy({ children: true })
    this.sprites.clear()
    this.maskMap?.destroy(true)
    this.glowMap?.destroy(true)
  }
}

/** Same light objects in the same order (the store replaces a light object when it changes). */
function sameLights(a: Light[], b: Light[]) {
  return a.length === b.length && a.every((l, i) => l === b[i])
}

function setSprite(s: Sprite, x: number, y: number, rotation: number, sx: number, sy: number, alpha: number) {
  s.position.set(x, y)
  s.rotation = rotation
  s.scale.set(sx, sy)
  s.alpha = alpha
}
