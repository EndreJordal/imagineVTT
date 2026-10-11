import { ColorMatrixFilter, Container, Graphics, Sprite, Texture, type Renderer } from 'pixi.js'
import { sceneBounds } from '../shared/geometry'
import { nightMatrix } from '../shared/night'
import type { Scene, Size } from '../shared/types'
import { LightingLayer } from './LightingLayer'

/**
 * Map image + grid, in scene coordinates, with day/night and light sources. Shared by the
 * GM and table views.
 *
 * At night the base (map + grid) is dimmed and desaturated. Light sources reveal an
 * undimmed copy of it through a light-map mask, and add their colour on top.
 */
export class SceneLayer extends Container {
  private base = new Container()
  private background = new Graphics()
  private mapSprite = new Sprite()
  private grid = new Graphics()

  /** The same map and grid, undimmed, shown where light falls. Shares texture and drawing. */
  private lit = new Container()
  private litMap = new Sprite()
  private litGrid = new Graphics(this.grid.context)
  private lighting = new LightingLayer()

  private gridKey = ''
  private imageToken = 0
  private mapSize: Size = { width: 0, height: 0 }
  // 'inherit' renders the filter at the screen's pixel density (the default, 1, blurs HiDPI).
  private night = new ColorMatrixFilter({ resolution: 'inherit' })
  private darkness = 0

  constructor() {
    super()
    this.base.addChild(this.background, this.mapSprite, this.grid)
    this.lit.addChild(this.litMap, this.litGrid)
    this.lit.mask = this.lighting.maskSprite
    this.addChild(
      this.base,
      this.lit,
      this.lighting.maskSprite,
      this.lighting.glowClip,
      this.lighting.glow,
    )
    this.updateLitVisibility()
  }

  /** Call every frame: animates light flicker. */
  animate(renderer: Renderer, seconds: number) {
    this.lighting.animate(renderer, seconds)
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

  private updateLitVisibility() {
    const on = this.lighting.active
    this.lit.visible = on
    this.lighting.glow.visible = on
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
    for (const sprite of [this.mapSprite, this.litMap]) {
      sprite.texture = texture
      sprite.setSize(this.mapSize) // sprite size is relative to the texture
    }
    if (old !== Texture.EMPTY) old.destroy(true)
  }

  update(scene: Scene) {
    this.setDarkness(scene.darkness)
    const bounds = sceneBounds(scene)
    const { x, y, width, height } = bounds
    this.mapSize = { width, height }
    for (const sprite of [this.mapSprite, this.litMap]) {
      sprite.setSize(this.mapSize)
      sprite.position.set(x, y)
    }
    this.lighting.sync(scene.lights, bounds, scene.grid.size, scene.darkness)
    this.updateLitVisibility()

    const { size, offsetX, offsetY, visible, color, opacity } = scene.grid
    const key = `${x},${y},${width},${height},${size},${offsetX},${offsetY},${visible},${color},${opacity}`
    if (key === this.gridKey) return
    this.gridKey = key

    this.background.clear().rect(x, y, width, height).fill(0x2a2a30)

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
