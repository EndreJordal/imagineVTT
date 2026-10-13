import { BufferImageSource, Container, ImageSource, Texture, type Renderer } from 'pixi.js'
import type { FogMemory } from '../shared/fog'
import { mapNatural, sceneBounds } from '../shared/geometry'
import { activeAreas, areaMask, hiddenGrid, softenHidden, type HiddenArea, type SoftRegion } from '../shared/hidden'
import { MEMORY_BRIGHTNESS, NIGHT_DESATURATION, NIGHT_DIMMING } from '../shared/night'
import type { AssetImages } from '../shared/mapObjects'
import type { Scene } from '../shared/types'
import { FogLayer } from './FogLayer'
import { LightingLayer } from './LightingLayer'
import { createMapMesh, SHARED_SLOTS } from './mapShader'
import { ObjectsLayer } from './ObjectsLayer'
import { CharacterLayer } from './CharacterLayer'
import { seenTokens } from '../shared/characters'

/**
 * Who the scene is drawn for under fog of war: the players see black, greyscale memory and
 * what is in sight; the GM sees everything, with unexplored parts shaded.
 */
export type FogViewer = 'players' | 'gm'

/** How dark the GM's shading over unexplored parts is. */
const GM_UNEXPLORED_SHADE = 0.55

/**
 * Map images are kept at no more than this many pixels per grid square. A TV shows about
 * 70 (an inch at TV resolution), and battlemaps are often drawn at 140–300: decoding them at
 * full size would spend GPU memory (shared with the system on a laptop) on detail nobody sees.
 */
const MAX_PX_PER_SQUARE = 100

/**
 * Map image + grid, in scene coordinates, with day/night, light sources and fog of war.
 * Shared by the GM and table views.
 *
 * Drawn in a single pass by the map shader (see mapShader.ts). The lighting and fog layers
 * keep small, low-resolution maps of light, sight and memory up to date for it.
 */
export class SceneLayer extends Container {
  private map = createMapMesh()
  private lighting = new LightingLayer()
  private fog = new FogLayer()
  private mapTexture: Texture | null = null
  private imageToken = 0
  /** The map image, and what's decoded: which image at which scale (1 = full size). */
  private image: Blob | null = null
  private decoded: { image: Blob | null; scale: number } | null = null
  /** The scale wanted for the current grid, and the image's full size (from the scene). */
  private wantedScale = 1
  private natural: { width: number; height: number } | null = null
  private changed: (() => void) | null = null
  /** Decoded map pixels; closed explicitly when replaced (Pixi doesn't, and they're big). */
  private bitmap: ImageBitmap | null = null
  private fogMode: 'off' | FogViewer = 'off'
  /** Out of sight is dimmed, not fogged (nothing to explore). */
  private dimOnly = false
  /** Images placed on the map, drawn over it with the same shading. */
  private objects = new ObjectsLayer(this.map.group)
  /** Character tokens, over everything on the map. */
  readonly characters = new CharacterLayer()
  /** Which tokens the players see, kept while what decides it is the same. */
  private seen: { inputs: unknown[]; ids: Set<string> } | null = null

  constructor() {
    super()
    this.addChild(this.map.mesh, this.objects, this.characters)
  }

  /** Called when something loaded in the background needs a redraw (object images). */
  set onChange(fn: () => void) {
    this.changed = fn
    this.objects.onChange = fn
    this.characters.onChange = fn
  }

  /** Whether frames are needed with nothing changed (flickering lights, animated objects). */
  isAnimating() {
    return this.lighting.animated || this.objects.animated || this.characters.animated
  }

  /** The images of the assets objects show (from the GM; kept with the scene). */
  setObjectImages(images: AssetImages) {
    this.objects.setImages(images)
    this.characters.setImages(images)
  }

  /** Call before each frame: animates light flicker, redraws sight when vision tokens move. */
  animate(renderer: Renderer, seconds: number) {
    this.lighting.animate(renderer, seconds)
    if (this.fogMode !== 'off') this.fog.render(renderer)
    // The light and sight maps may have been created or resized: point the shader at them.
    const u = this.map.uniforms
    this.map.setTexture('uLightMask', this.lighting.maskTexture)
    this.map.setTexture('uGlow', this.lighting.glowTexture)
    this.map.setTexture('uVision', this.fog.visionTexture)
    u.uLightUv[0] = this.lighting.uvScale.x
    u.uLightUv[1] = this.lighting.uvScale.y
    u.uVisionUv[0] = this.fog.uvScale.x
    u.uVisionUv[1] = this.fog.uvScale.y
    u.uLightsOn = this.lighting.active ? 1 : 0
    this.map.uniformsChanged()
    this.shareTextures()
    this.objects.animate(seconds)
    this.characters.animate(seconds)
  }

  /** Objects read the same light, sight and memory maps as the map. */
  private shareTextures() {
    const sources = {
      uLightMask: this.lighting.maskTexture,
      uGlow: this.lighting.glowTexture,
      uVision: this.fog.visionTexture,
      uMemory: this.fog.memorySource,
      uHidden: this.hiddenTexture?.source ?? null,
    }
    for (const slot of SHARED_SLOTS) this.objects.setShared(slot, sources[slot] ?? null)
  }

  /** Fog memory from the GM (the same grid object is redrawn when its version changes). */
  setFogMemory(memory: FogMemory | null) {
    const replaced = this.fog.setMemory(memory)
    this.map.setTexture('uMemory', this.fog.memorySource)
    this.objects.setShared('uMemory', this.fog.memorySource)
    replaced?.destroy(true) // only now that nothing is bound to it
  }

  async setMapImage(image: Blob | null) {
    this.image = image
    // Decode once the scene has said what size it wants (it usually follows at once).
    await new Promise((r) => setTimeout(r))
    await this.decodeMap()
  }

  /** Decode the map image at the wanted scale, unless that's what's there already. */
  private async decodeMap() {
    const image = this.image
    const scale = this.wantedScale
    if (this.decoded && this.decoded.image === image && this.decoded.scale === scale) return
    const token = ++this.imageToken
    const bitmap = image ? await decode(image, scale, this.natural) : null
    if (token !== this.imageToken) {
      bitmap?.close()
      return
    }
    this.decoded = { image, scale }
    const old = this.mapTexture
    // Mipmaps: a zoomed-out view then samples a small copy instead of the full image.
    this.mapTexture = bitmap
      ? new Texture({ source: new ImageSource({ resource: bitmap, autoGenerateMipmaps: true }) })
      : null
    this.map.setTexture('uMap', this.mapTexture?.source ?? null)
    this.map.uniforms.uHasMap = this.mapTexture ? 1 : 0
    this.map.uniformsChanged()
    this.releaseMap(old)
    this.bitmap = bitmap
  }

  private releaseMap(texture: Texture | null) {
    texture?.destroy(true)
    this.bitmap?.close()
    this.bitmap = null
  }

  /** Hidden areas, soft-edged, as drawn: rebuilt when they (or their softness) change. */
  private hiddenTexture: Texture | null = null
  private hiddenDrawn: { areas: HiddenArea[] | undefined; cellsPerSquare: number } | null = null
  /** Each area softened, kept while it's unchanged (most edits change one area). */
  private softened = new WeakMap<HiddenArea, { cellsPerSquare: number; region: SoftRegion | null }>()

  /** Whether any hidden areas are shown (and their texture is up to date). */
  private syncHidden(scene: Scene): boolean {
    const areas = activeAreas(scene)
    const bounds = sceneBounds(scene)
    const { cols, rows } = hiddenGrid(bounds)
    const cellsPerSquare = (cols / bounds.width) * scene.grid.size
    const drawn = this.hiddenDrawn
    if (drawn && drawn.areas === areas && drawn.cellsPerSquare === cellsPerSquare) return !!this.hiddenTexture
    this.hiddenDrawn = { areas, cellsPerSquare }
    // Each area with its own soft edges, where they overlap the darker winning, drawn into
    // the texture's own pixels (made anew only when the grid changes size).
    let source = this.hiddenTexture?.source as BufferImageSource | undefined
    const reusable = source && source.width === cols && source.height === rows
    const pixels = reusable ? (source!.resource as Uint8Array) : new Uint8Array(cols * rows)
    pixels.fill(0)
    let any = false
    for (const area of areas ?? []) {
      const mask = areaMask(area, bounds)
      if (!mask) continue
      let soft = this.softened.get(area)
      if (!soft || soft.cellsPerSquare !== cellsPerSquare) {
        soft = { cellsPerSquare, region: softenHidden(mask, cols, rows, area.softness * cellsPerSquare) }
        this.softened.set(area, soft)
      }
      const r = soft.region
      if (!r) continue
      for (let j = 0; j < r.height; j++) {
        const row = (r.y + j) * cols + r.x
        for (let i = 0; i < r.width; i++) {
          const v = r.pixels[j * r.width + i]
          if (v > pixels[row + i]) pixels[row + i] = v
        }
      }
      any = true
    }
    if (!any) {
      this.releaseHidden()
      return false
    }
    if (reusable) {
      source!.update()
      return true
    }
    this.releaseHidden()
    source = new BufferImageSource({ resource: pixels, width: cols, height: rows, format: 'r8unorm', scaleMode: 'linear' })
    this.hiddenTexture = new Texture({ source })
    this.map.setTexture('uHidden', source)
    this.objects.setShared('uHidden', source)
    return true
  }

  private releaseHidden() {
    if (!this.hiddenTexture) return
    // Unbound first: Pixi warns about a destroyed texture still in use.
    this.map.setTexture('uHidden', null)
    this.objects.setShared('uHidden', null)
    this.hiddenTexture.destroy(true)
    this.hiddenTexture = null
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    this.releaseHidden()
    this.imageToken++ // drop any decode still in flight
    this.releaseMap(this.mapTexture)
    this.mapTexture = null
    this.lighting.destroy()
    this.fog.destroy()
    this.objects.destroy()
    this.characters.destroy()
    super.destroy(options)
  }

  /** `viewer` is who this view is for when something is obscured. */
  update(scene: Scene, viewer: FogViewer) {
    const mode = scene.fog.mode
    // The GM sees everything when what's out of sight is only dimmed (peeking shows it).
    this.fogMode = mode === 'off' || (mode === 'dim' && viewer === 'gm') ? 'off' : viewer
    this.dimOnly = mode === 'dim'
    const bounds = sceneBounds(scene)
    // Decode the map again if it should be kept at a clearly different size now.
    const map = scene.map
    if (map) {
      const pxPerSquare = (scene.grid.size * mapNatural(map).width) / map.width
      this.natural = { width: map.naturalWidth, height: map.naturalHeight }
      const wanted = quantize(Math.min(1, MAX_PX_PER_SQUARE / pxPerSquare))
      if (wanted !== this.wantedScale) {
        this.wantedScale = wanted
        if (this.decoded && this.decoded.scale !== wanted) void this.decodeMap().then(() => this.changed?.())
      }
    }
    this.map.mesh.position.set(bounds.x, bounds.y)
    this.map.mesh.scale.set(bounds.width, bounds.height)
    this.lighting.sync(scene.lights, bounds, scene.grid.size, scene.darkness, scene.walls)
    this.fog.sync(scene.lights, bounds, scene.grid.size, scene.walls)
    this.objects.sync(scene.objects ?? [], { players: viewer === 'players', obscured: this.fogMode === 'players' })
    const inputs = [
      scene.characters, scene.lights, scene.walls, scene.fog.mode, scene.darkness, scene.hiddenAreas,
      scene.hiddenEnabled, scene.grid, scene.map,
    ]
    if (!this.seen || inputs.some((v, i) => v !== this.seen!.inputs[i])) this.seen = { inputs, ids: seenTokens(scene) }
    this.characters.sync(scene, this.seen.ids, viewer === 'players')

    const u = this.map.uniforms
    u.uBounds.set([bounds.x, bounds.y, bounds.width, bounds.height])
    u.uMapTurns = map?.turns ?? 0
    const { size, offsetX, offsetY, visible, color, opacity } = scene.grid
    u.uGrid.set([size, offsetX, offsetY, visible && size >= 2 ? 1 : 0])
    const rgb = parseInt(color.slice(1), 16)
    u.uGridColor.set([((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, opacity])
    const d = Math.min(1, Math.max(0, scene.darkness))
    u.uSaturation = 1 - NIGHT_DESATURATION * d
    u.uBrightness = 1 - NIGHT_DIMMING * d
    u.uLightsOn = this.lighting.active ? 1 : 0
    u.uFogMode = this.fogMode === 'off' ? 0 : this.fogMode === 'gm' ? 2 : this.dimOnly ? 3 : 1
    u.uMemoryBrightness = MEMORY_BRIGHTNESS
    u.uGmShade = GM_UNEXPLORED_SHADE
    // Hidden areas apply with or without fog of war: black for the players, shaded for the GM.
    u.uHiddenMode = this.syncHidden(scene) ? (viewer === 'gm' ? 2 : 1) : 0
    this.map.uniformsChanged()
  }
}

/** Decode an image at a fraction of its size (the browser scales it while decoding). */
async function decode(image: Blob, scale: number, size: { width: number; height: number } | null): Promise<ImageBitmap> {
  if (scale >= 1 || !size) return createImageBitmap(image)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  return createImageBitmap(image, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
}

/** Scales in steps, so small grid adjustments don't decode the map again. */
function quantize(scale: number) {
  if (scale >= 0.9) return 1
  return Math.max(0.125, Math.round(scale * 8) / 8)
}
