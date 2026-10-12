import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js'
import {
  animateLight,
  emitsLight,
  flickerOf,
  LIGHT_PRESETS,
  seedOf,
  type Light,
  type LightFrame,
} from '../shared/lights'
import type { Rect } from '../shared/types'
import { visibilityPolygon, wallSegments, type Wall } from '../shared/visibility'
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

/** How far past its radius a light's flicker can reach (its wall clip covers that much). */
const REACH_SLACK = 1.3

interface LightSprites {
  /** The light in each map, clipped to what it reaches past walls. */
  maskGroup: Container
  glowGroup: Container
  /** Its line of sight (walls block light), and what it was worked out for. */
  maskClip: Graphics
  glowClip: Graphics
  clipKey: string
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
  /**
   * Map uv -> light map uv: the light maps are rounded up to whole pixels, so they cover a
   * little more than the map.
   */
  readonly uvScale = { x: 1, y: 1 }

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
  private walls: Wall[] = []
  /** Something changed since the maps were last drawn. */
  private dirty = true

  /** Whether anything is lit; the scene layer hides the lit copy otherwise. */
  /** Whether any lit light flickers, so the scene needs animation frames. */
  get animated() {
    return this.active && this.lights.some((l) => l.on && LIGHT_PRESETS[l.kind].animation !== 'steady')
  }

  get active() {
    return this.darkness > 0 && this.lights.some((l) => l.on && emitsLight(l))
  }

  /** `walls` block light (closed doors too), whatever's obscured. */
  sync(all: Light[], bounds: Rect, gridSize: number, darkness: number, walls: Wall[]) {
    const lights = all.filter(emitsLight) // vision tokens give no light
    if (
      !sameLights(lights, this.lights) ||
      gridSize !== this.gridSize ||
      darkness !== this.darkness ||
      walls !== this.walls
    ) {
      this.dirty = true
    }
    if (walls !== this.walls) for (const sp of this.sprites.values()) sp.clipKey = ''
    this.walls = walls
    this.lights = lights
    this.gridSize = gridSize
    this.darkness = darkness
    this.resize(bounds)

    const ids = new Set(lights.map((l) => l.id))
    for (const [id, s] of this.sprites) {
      if (ids.has(id)) continue
      s.maskGroup.destroy({ children: true })
      s.glowGroup.destroy({ children: true })
      this.sprites.delete(id)
    }
    for (const light of lights) {
      if (this.sprites.has(light.id)) continue
      const shape = LIGHT_PRESETS[light.kind].shape
      const texture = shape === 'cone' ? coneTexture() : radialTexture()
      const anchor = shape === 'cone' ? { x: 0, y: 0.5 } : { x: 0.5, y: 0.5 }
      const s: LightSprites = {
        maskGroup: new Container(),
        glowGroup: new Container(),
        maskClip: new Graphics(),
        glowClip: new Graphics(),
        clipKey: '',
        mask: new Sprite({ texture, anchor, blendMode: 'add' }),
        glow: new Sprite({ texture, anchor, blendMode: 'add' }),
      }
      s.maskGroup.addChild(s.mask, s.maskClip)
      s.glowGroup.addChild(s.glow, s.glowClip)
      if (shape === 'cone') {
        s.spillMask = new Sprite({ texture: radialTexture(), anchor: 0.5, blendMode: 'add' })
        s.spillGlow = new Sprite({ texture: radialTexture(), anchor: 0.5, blendMode: 'add' })
        s.maskGroup.addChild(s.spillMask)
        s.glowGroup.addChild(s.spillGlow)
      }
      this.maskRoot.addChild(s.maskGroup)
      this.glowRoot.addChild(s.glowGroup)
      this.sprites.set(light.id, s)
    }
    this.clipToWalls()
  }

  /**
   * Walls block light: each light clipped to its line of sight (worked out again only when
   * it moved, grew or the walls changed). Without walls, nothing to clip.
   */
  private clipToWalls() {
    const segments = this.walls.length ? wallSegments(this.walls) : []
    for (const light of this.lights) {
      const s = this.sprites.get(light.id)!
      if (!segments.length) {
        if (s.clipKey) {
          s.maskGroup.mask = null
          s.glowGroup.mask = null
          s.maskClip.clear()
          s.glowClip.clear()
          s.clipKey = ''
        }
        continue
      }
      const reach = light.radius * this.gridSize * REACH_SLACK * (LIGHT_PRESETS[light.kind].shape === 'tube' ? TUBE_STRETCH : 1)
      const key = `${light.x},${light.y},${reach}`
      if (key === s.clipKey && s.maskGroup.mask) continue
      s.clipKey = key
      const polygon = visibilityPolygon(light, reach, segments)
      s.maskClip.clear().poly(polygon).fill(0xffffff)
      s.glowClip.clear().poly(polygon).fill(0xffffff)
      s.maskGroup.mask = s.maskClip
      s.glowGroup.mask = s.glowClip
    }
  }

  /** Redraw the light maps for time t (seconds), if anything changed or flickers. */
  animate(renderer: Renderer, t: number) {
    if (!this.active || !this.maskMap || !this.glowMap) return
    const animated = this.lights.some((l) => l.on && LIGHT_PRESETS[l.kind].animation !== 'steady')
    if (!this.dirty && !animated) return
    this.dirty = false

    for (const light of this.lights) {
      const preset = LIGHT_PRESETS[light.kind]
      const flicker = flickerOf(light)
      const input = flicker && { flicker, intensity: light.intensity, buzz: !!preset.buzz }
      this.place(light, animateLight(preset.animation, t, seedOf(light.id), input))
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
    } else {
      this.maskMap.source.resize(width, height)
      this.glowMap.source.resize(width, height)
    }
    this.uvScale.x = bounds.width / this.factor / width
    this.uvScale.y = bounds.height / this.factor / height
  }

  /** How much of the day-lit map shows through (red channel), over the map's bounds. */
  get maskTexture() {
    return this.maskMap?.source ?? null
  }

  /** Light colour to add, over the map's bounds. */
  get glowTexture() {
    return this.glowMap?.source ?? null
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
