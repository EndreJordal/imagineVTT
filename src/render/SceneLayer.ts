import { ColorMatrixFilter, Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js'
import type { FogMemory } from '../shared/fog'
import { sceneBounds } from '../shared/geometry'
import { memoryMatrix, nightMatrix } from '../shared/night'
import type { Scene, Size } from '../shared/types'
import { FogLayer } from './FogLayer'
import { LightingLayer } from './LightingLayer'

/**
 * Who the scene is drawn for under fog of war: the players see black, greyscale memory and
 * what is in sight; the GM sees everything, with unexplored parts shaded.
 */
export type FogViewer = 'players' | 'gm'

/** How dark the GM's shading over unexplored parts is. */
const GM_UNEXPLORED_SHADE = 0.55

/**
 * Map image + grid, in scene coordinates, with day/night, light sources and fog of war.
 * Shared by the GM and table views.
 *
 * - At night the base (map + grid) is dimmed and desaturated. Light sources reveal an
 *   undimmed copy of it through a light-map mask, and add their colour on top.
 * - Under fog, for the players, all of that is masked to what vision tokens see now; below
 *   it, explored parts show as a greyscale memory; the rest stays black.
 */
export class SceneLayer extends Container {
  /** Everything the players would see with no fog. */
  private content = new Container()
  private base = new Container()
  private background = new Graphics()
  private mapSprite = new Sprite()
  private grid = new Graphics()

  /** The same map and grid, undimmed, shown where light falls. Shares texture and drawing. */
  private lit = new Container()
  private litMap = new Sprite()
  private litGrid = new Graphics(this.grid.context)
  private lighting = new LightingLayer()

  /** Explored-but-out-of-sight memory: greyscale map and grid. Shares texture and drawing. */
  private memory = new Container()
  private memoryMap = new Sprite()
  private memoryGrid = new Graphics(this.grid.context)
  private fog = new FogLayer()
  /** GM view under fog: shades what the players haven't explored. */
  private gmShade = new Graphics()

  private gridKey = ''
  private imageToken = 0
  /** Decoded map pixels; closed explicitly when replaced (Pixi doesn't, and they're big). */
  private bitmap: ImageBitmap | null = null
  private mapSize: Size = { width: 0, height: 0 }
  // 'inherit' renders the filter at the screen's pixel density (the default, 1, blurs HiDPI).
  private night = new ColorMatrixFilter({ resolution: 'inherit' })
  private darkness = 0
  private fogMode: 'off' | FogViewer = 'off'

  constructor() {
    super()
    this.base.addChild(this.background, this.mapSprite, this.grid)
    this.lit.addChild(this.litMap, this.litGrid)
    this.lit.mask = this.lighting.maskSprite
    this.content.addChild(this.base, this.lit, this.lighting.maskSprite, this.lighting.glowSprite)

    this.memory.addChild(this.memoryMap, this.memoryGrid)
    const memoryFilter = new ColorMatrixFilter({ resolution: 'inherit' })
    memoryFilter.matrix = memoryMatrix() as ColorMatrixFilter['matrix']
    this.memory.filters = [memoryFilter]
    this.memory.mask = this.fog.memoryMask
    this.gmShade.setMask({ mask: this.fog.memoryMaskGm, inverse: true })

    // Mask sprites must be in the display list for their transforms, but never draw
    // themselves (Pixi only switches that off once they're in use as a mask).
    const fogMasks = [this.fog.visionMask, this.fog.memoryMask, this.fog.memoryMaskGm]
    for (const mask of fogMasks) mask.renderable = false
    this.addChild(this.memory, this.content, this.gmShade, ...fogMasks)
    this.updateLitVisibility()
    this.setFogMode('off')
  }

  /** Whether frames are needed with nothing changed (flickering lights). */
  isAnimating() {
    return this.lighting.animated
  }

  /** Call before each frame: animates light flicker, redraws sight when vision tokens move. */
  animate(renderer: Renderer, seconds: number) {
    this.lighting.animate(renderer, seconds)
    if (this.fogMode !== 'off') this.fog.render(renderer)
  }

  /** Fog memory from the GM (the same grid object is redrawn when its version changes). */
  setFogMemory(memory: FogMemory | null) {
    this.fog.setMemory(memory)
  }

  /** Day–night filter over the base. Off entirely at day, so nothing is resampled. */
  private setDarkness(darkness: number) {
    if (darkness === this.darkness) return
    this.darkness = darkness
    if (darkness <= 0) {
      this.base.filters = []
      return
    }
    this.night.matrix = nightMatrix(darkness) as ColorMatrixFilter['matrix']
    this.base.filters = [this.night]
  }

  private setFogMode(mode: 'off' | FogViewer) {
    this.fogMode = mode
    this.memory.visible = mode === 'players'
    this.gmShade.visible = mode === 'gm'
    this.content.mask = mode === 'players' ? this.fog.visionMask : null
  }

  private updateLitVisibility() {
    const on = this.lighting.active
    this.lit.visible = on
    this.lighting.glowSprite.visible = on
  }

  async setMapImage(image: Blob | null) {
    const token = ++this.imageToken
    const bitmap = image ? await createImageBitmap(image) : null
    if (token !== this.imageToken) {
      bitmap?.close()
      return
    }
    const old = this.mapSprite.texture
    const texture = bitmap ? Texture.from(bitmap) : Texture.EMPTY
    for (const sprite of [this.mapSprite, this.litMap, this.memoryMap]) {
      sprite.texture = texture
      sprite.setSize(this.mapSize) // sprite size is relative to the texture
    }
    this.releaseMap(old)
    this.bitmap = bitmap
  }

  private releaseMap(texture: Texture) {
    if (texture !== Texture.EMPTY) texture.destroy(true)
    this.bitmap?.close()
    this.bitmap = null
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    this.imageToken++ // drop any decode still in flight
    this.releaseMap(this.mapSprite.texture)
    this.lighting.destroy()
    this.fog.destroy()
    super.destroy(options)
  }

  /** `viewer` is who this view is for when fog of war is on. */
  update(scene: Scene, viewer: FogViewer) {
    this.setDarkness(scene.darkness)
    const fogMode = scene.fog.enabled ? viewer : 'off'
    if (fogMode !== this.fogMode) this.setFogMode(fogMode)

    const bounds = sceneBounds(scene)
    const { x, y, width, height } = bounds
    this.mapSize = { width, height }
    for (const sprite of [this.mapSprite, this.litMap, this.memoryMap]) {
      sprite.setSize(this.mapSize)
      sprite.position.set(x, y)
    }
    this.lighting.sync(scene.lights, bounds, scene.grid.size, scene.darkness)
    this.fog.sync(scene.lights, bounds, scene.grid.size, scene.walls)
    this.updateLitVisibility()

    const { size, offsetX, offsetY, visible, color, opacity } = scene.grid
    const key = `${x},${y},${width},${height},${size},${offsetX},${offsetY},${visible},${color},${opacity}`
    if (key === this.gridKey) return
    this.gridKey = key

    this.background.clear().rect(x, y, width, height).fill(0x2a2a30)
    this.gmShade.clear().rect(x, y, width, height).fill({ color: 0x000000, alpha: GM_UNEXPLORED_SHADE })

    // The grid is fixed in scene space; it is drawn only where the map is.
    this.grid.clear()
    if (!visible || size < 2) return
    const right = x + width
    const bottom = y + height
    const firstLine = (from: number, offset: number) => from + mod(offset - from, size)
    for (let gx = firstLine(x, offsetX); gx <= right; gx += size) this.grid.moveTo(gx, y).lineTo(gx, bottom)
    for (let gy = firstLine(y, offsetY); gy <= bottom; gy += size) this.grid.moveTo(x, gy).lineTo(right, gy)
    this.grid.stroke({ width: 1, color, alpha: opacity, pixelLine: true })
  }
}

function mod(n: number, m: number) {
  return ((n % m) + m) % m
}
