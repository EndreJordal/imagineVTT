import { BufferImageSource, Container, Graphics, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js'
import type { FogMemory } from '../shared/fog'
import type { Light } from '../shared/lights'
import type { Rect } from '../shared/types'
import { visibilityPolygon, wallSegments, type Wall } from '../shared/visibility'
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
  /** Per vision token: its sight, clipped to its line of sight by a polygon mask. */
  private viewers = new Map<string, { root: Container; sight: Sprite; clip: Graphics; key: string }>()
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 }
  private factor = 1
  private dirty = true

  private memoryTexture: Texture | null = null
  private memory: FogMemory | null = null

  /** Place the vision tokens' sight (lights with vision on), blocked by walls. */
  sync(lights: Light[], bounds: Rect, gridSize: number, walls: Wall[]) {
    this.resize(bounds)
    const seeing = lights.filter((l) => l.vision)
    const ids = new Set(seeing.map((l) => l.id))
    for (const [id, v] of this.viewers) {
      if (ids.has(id)) continue
      v.root.destroy({ children: true })
      this.viewers.delete(id)
      this.dirty = true
    }
    const segments = walls.length ? wallSegments(walls) : []
    for (const l of seeing) {
      let v = this.viewers.get(l.id)
      if (!v) {
        const sight = new Sprite({ texture: visionTexture(), anchor: 0.5, blendMode: 'add' })
        const clip = new Graphics()
        const root = new Container()
        root.addChild(sight, clip)
        sight.mask = clip
        this.visionRoot.addChild(root)
        v = { root, sight, clip, key: '' }
        this.viewers.set(l.id, v)
      }
      const range = l.visionRange * gridSize
      // Recompute line of sight only when the viewer, its range or the walls changed.
      const key = `${l.x},${l.y},${range},${walls === this.walls ? this.wallsVersion : ++this.wallsVersion}`
      this.walls = walls
      if (key === v.key) continue
      v.key = key
      v.sight.position.set(l.x, l.y)
      v.sight.scale.set(range / (v.sight.texture.width / 2))
      v.clip.clear().poly(visibilityPolygon(l, range, segments)).fill(0xffffff)
      this.dirty = true
    }
  }

  private walls: Wall[] = []
  private wallsVersion = 0

  /** Show this memory grid (the same grid object is redrawn when its version changes). */
  setMemory(memory: FogMemory | null) {
    this.memory = memory
    if (!memory) return
    // Uploaded as-is, one byte per cell (a single-channel texture: masks read the red
    // channel). The same grid object is updated in place, so re-upload its new contents.
    const source = this.memoryTexture?.source as BufferImageSource | undefined
    if (source && source.width === memory.cols && source.height === memory.rows) {
      // Same size: the GM's own grid updated in place, or the table's fresh copy of it.
      const pixels = source.resource as Uint8Array
      if (pixels !== memory.data) pixels.set(memory.data)
      source.update()
    } else {
      this.memoryTexture?.destroy(true)
      this.memoryTexture = new Texture({
        source: new BufferImageSource({
          resource: memory.data,
          width: memory.cols,
          height: memory.rows,
          format: 'r8unorm',
          scaleMode: 'linear',
        }),
      })
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
