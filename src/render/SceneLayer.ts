import { Container, ImageSource, Texture, type Renderer } from 'pixi.js'
import type { FogMemory } from '../shared/fog'
import { sceneBounds } from '../shared/geometry'
import { MEMORY_BRIGHTNESS, NIGHT_DESATURATION, NIGHT_DIMMING } from '../shared/night'
import type { AssetImages } from '../shared/mapObjects'
import type { Scene } from '../shared/types'
import { FogLayer } from './FogLayer'
import { LightingLayer } from './LightingLayer'
import { createMapMesh, SHARED_SLOTS } from './mapShader'
import { ObjectsLayer } from './ObjectsLayer'

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
 * Drawn in a single pass by the map shader (see mapShader.ts). The lighting and fog layers
 * keep small, low-resolution maps of light, sight and memory up to date for it.
 */
export class SceneLayer extends Container {
  private map = createMapMesh()
  private lighting = new LightingLayer()
  private fog = new FogLayer()
  private mapTexture: Texture | null = null
  private imageToken = 0
  /** Decoded map pixels; closed explicitly when replaced (Pixi doesn't, and they're big). */
  private bitmap: ImageBitmap | null = null
  private fogMode: 'off' | FogViewer = 'off'
  /** Images placed on the map, drawn over it with the same shading. */
  private objects = new ObjectsLayer(this.map.group)

  constructor() {
    super()
    this.addChild(this.map.mesh, this.objects)
  }

  /** Called when something loaded in the background needs a redraw (object images). */
  set onChange(fn: () => void) {
    this.objects.onChange = fn
  }

  /** Whether frames are needed with nothing changed (flickering lights, animated objects). */
  isAnimating() {
    return this.lighting.animated || this.objects.animated
  }

  /** The images of the assets objects show (from the GM; kept with the scene). */
  setObjectImages(images: AssetImages) {
    this.objects.setImages(images)
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
  }

  /** Objects read the same light, sight and memory maps as the map. */
  private shareTextures() {
    const sources = {
      uLightMask: this.lighting.maskTexture,
      uGlow: this.lighting.glowTexture,
      uVision: this.fog.visionTexture,
      uMemory: this.fog.memorySource,
    }
    for (const slot of SHARED_SLOTS) this.objects.setShared(slot, sources[slot] ?? null)
  }

  /** Fog memory from the GM (the same grid object is redrawn when its version changes). */
  setFogMemory(memory: FogMemory | null) {
    this.fog.setMemory(memory)
    this.map.setTexture('uMemory', this.fog.memorySource)
    this.objects.setShared('uMemory', this.fog.memorySource)
  }

  async setMapImage(image: Blob | null) {
    const token = ++this.imageToken
    const bitmap = image ? await createImageBitmap(image) : null
    if (token !== this.imageToken) {
      bitmap?.close()
      return
    }
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

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    this.imageToken++ // drop any decode still in flight
    this.releaseMap(this.mapTexture)
    this.mapTexture = null
    this.lighting.destroy()
    this.fog.destroy()
    this.objects.destroy()
    super.destroy(options)
  }

  /** `viewer` is who this view is for when fog of war is on. */
  update(scene: Scene, viewer: FogViewer) {
    this.fogMode = scene.fog.enabled ? viewer : 'off'
    const bounds = sceneBounds(scene)
    this.map.mesh.position.set(bounds.x, bounds.y)
    this.map.mesh.scale.set(bounds.width, bounds.height)
    this.lighting.sync(scene.lights, bounds, scene.grid.size, scene.darkness)
    this.fog.sync(scene.lights, bounds, scene.grid.size, scene.walls)
    this.objects.sync(scene.objects ?? [])

    const u = this.map.uniforms
    u.uBounds.set([bounds.x, bounds.y, bounds.width, bounds.height])
    const { size, offsetX, offsetY, visible, color, opacity } = scene.grid
    u.uGrid.set([size, offsetX, offsetY, visible && size >= 2 ? 1 : 0])
    const rgb = parseInt(color.slice(1), 16)
    u.uGridColor.set([((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, opacity])
    const d = Math.min(1, Math.max(0, scene.darkness))
    u.uSaturation = 1 - NIGHT_DESATURATION * d
    u.uBrightness = 1 - NIGHT_DIMMING * d
    u.uLightsOn = this.lighting.active ? 1 : 0
    u.uFogMode = this.fogMode === 'off' ? 0 : this.fogMode === 'players' ? 1 : 2
    u.uMemoryBrightness = MEMORY_BRIGHTNESS
    u.uGmShade = GM_UNEXPLORED_SHADE
    this.map.uniformsChanged()
  }
}
