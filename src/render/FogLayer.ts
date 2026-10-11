import { Container, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import type { FogMemory } from '../shared/fog'
import type { Light } from '../shared/lights'
import type { Rect } from '../shared/types'
import { visionTexture } from './lightTextures'

/** Longest side of the vision map; sight edges are soft, so coarse is fine. */
const VISION_MAP_SIZE = 1024

/**
 * Fog of war rendering: masks for what the party sees right now (vision map, drawn from the
 * vision tokens) and what it has seen (memory, from the GM's fog memory grid).
 *
 * Each mask is a scene-space sprite; a Pixi mask sprite can only mask one thing, so there is
 * one sprite per use.
 */
export class FogLayer {
  /** In sight now: masks the normal scene for the players. */
  readonly visionMask = new Sprite()
  /** Explored: masks the greyscale memory for the players. */
  readonly memoryMask = new Sprite()
  /** Explored: inverse-masks the GM's "unexplored" shading. */
  readonly memoryMaskGm = new Sprite()

  private visionRoot = new Container()
  private visionMap: RenderTexture | null = null
  private viewers = new Map<string, Sprite>()
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private factor = 1
  private dirty = true

  private memoryCanvas = document.createElement('canvas')
  private memoryTexture: Texture | null = null
  private memory: FogMemory | null = null

  /** Place the vision tokens' sight (lights with vision on). */
  sync(lights: Light[], bounds: Rect, gridSize: number) {
    this.resize(bounds)
    const seeing = lights.filter((l) => l.vision)
    const ids = new Set(seeing.map((l) => l.id))
    for (const [id, sprite] of this.viewers) {
      if (ids.has(id)) continue
      sprite.destroy()
      this.viewers.delete(id)
      this.dirty = true
    }
    for (const l of seeing) {
      let sprite = this.viewers.get(l.id)
      if (!sprite) {
        sprite = new Sprite({ texture: visionTexture(), anchor: 0.5, blendMode: 'add' })
        this.visionRoot.addChild(sprite)
        this.viewers.set(l.id, sprite)
      }
      const scale = (l.visionRange * gridSize) / (sprite.texture.width / 2)
      if (sprite.x !== l.x || sprite.y !== l.y || sprite.scale.x !== scale) {
        sprite.position.set(l.x, l.y)
        sprite.scale.set(scale)
        this.dirty = true
      }
    }
  }

  /** Show this memory grid (the same grid object is redrawn when its version changes). */
  setMemory(memory: FogMemory | null) {
    this.memory = memory
    if (!memory) return
    const canvas = this.memoryCanvas
    if (canvas.width !== memory.cols || canvas.height !== memory.rows) {
      canvas.width = memory.cols
      canvas.height = memory.rows
      this.memoryTexture?.destroy(true)
      this.memoryTexture = null
    }
    const ctx = canvas.getContext('2d')!
    const img = ctx.createImageData(memory.cols, memory.rows)
    for (let i = 0; i < memory.data.length; i++) {
      const v = memory.data[i]
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    if (this.memoryTexture) {
      this.memoryTexture.source.update()
    } else {
      this.memoryTexture = Texture.from(canvas)
      this.memoryMask.texture = this.memoryTexture
      this.memoryMaskGm.texture = this.memoryTexture
    }
    this.placeMemory()
  }

  /** Redraw the vision map if any viewer moved. */
  render(renderer: Renderer) {
    if (!this.dirty || !this.visionMap) return
    this.dirty = false
    this.visionRoot.position.set(-this.bounds.x / this.factor, -this.bounds.y / this.factor)
    this.visionRoot.scale.set(1 / this.factor)
    renderer.render({ container: this.visionRoot, target: this.visionMap, clear: true, clearColor: [0, 0, 0, 1] })
  }

  private resize(bounds: Rect) {
    const b = this.bounds
    if (b.x === bounds.x && b.y === bounds.y && b.width === bounds.width && b.height === bounds.height) return
    this.bounds = { ...bounds }
    this.dirty = true
    this.factor = Math.max(1, Math.max(bounds.width, bounds.height) / VISION_MAP_SIZE)
    const width = Math.max(1, Math.ceil(bounds.width / this.factor))
    const height = Math.max(1, Math.ceil(bounds.height / this.factor))
    if (!this.visionMap) {
      this.visionMap = RenderTexture.create({ width, height, resolution: 1 })
      this.visionMask.texture = this.visionMap
    } else {
      this.visionMap.source.resize(width, height)
    }
    this.visionMask.position.set(bounds.x, bounds.y)
    this.visionMask.scale.set(this.factor)
    this.placeMemory()
  }

  /** The memory grid spans the map's bounds. */
  private placeMemory() {
    const m = this.memory
    if (!m) return
    for (const sprite of [this.memoryMask, this.memoryMaskGm]) {
      sprite.position.set(this.bounds.x, this.bounds.y)
      sprite.scale.set(this.bounds.width / m.cols, this.bounds.height / m.rows)
    }
  }

  destroy() {
    this.visionRoot.destroy({ children: true })
    this.viewers.clear()
    this.visionMap?.destroy(true)
    this.memoryTexture?.destroy(true)
  }
}
