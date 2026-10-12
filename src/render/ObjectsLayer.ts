import { Container, ImageSource, type TextureSource, type UniformGroup } from 'pixi.js'
import { objectCorners, type AssetImage, type AssetImages, type MapObject } from '../shared/mapObjects'
import { createObjectMesh, SHARED_SLOTS, type SharedTextureSlot } from './mapShader'

type ObjectMesh = ReturnType<typeof createObjectMesh>

interface LoadedImage {
  image: AssetImage
  source: TextureSource | null
  bitmap: ImageBitmap | null
  users: number
}

/**
 * Objects placed on the map, drawn with the map's shading (see createObjectMesh). Images
 * are decoded once per asset and shared by every object showing it; animations step
 * through their sprite sheet.
 */
export class ObjectsLayer extends Container {
  private meshes = new Map<string, { mesh: ObjectMesh; asset: string; placed: MapObject | null }>()
  private loaded = new Map<string, LoadedImage>()
  private images: AssetImages = {}
  /** Who it's drawn for, and whether something is obscured (see sync). */
  private view = { players: false, obscured: false }
  private shared: Partial<Record<SharedTextureSlot, TextureSource | null>> = {}
  private objects: MapObject[] = []
  private mapGroup: UniformGroup
  /** Called when a decode finishes, so the view redraws. */
  onChange: () => void = () => {}

  constructor(mapGroup: UniformGroup) {
    super()
    this.mapGroup = mapGroup
  }

  /** Whether any shown object is animated (and its frames are in). */
  get animated() {
    return this.objects.some((o) => this.images[o.asset]?.frames && this.loaded.get(o.asset)?.source)
  }

  setImages(images: AssetImages) {
    this.images = images
    // An asset whose image changed (re-imported) is decoded afresh.
    for (const [key, l] of this.loaded) {
      if (images[key] !== l.image) this.unload(key)
    }
    this.sync(this.objects, this.view)
  }

  /** The light, sight and memory maps the shading reads. */
  setShared(slot: SharedTextureSlot, source: TextureSource | null) {
    if (this.shared[slot] === source) return
    this.shared[slot] = source
    for (const { mesh } of this.meshes.values()) mesh.setTexture(slot, source)
  }

  /**
   * `view.players`: drawn for the players, so objects the GM hasn't shown are left out (the
   * GM sees them faintly); with `view.obscured` too, objects shown only in sight, or once
   * seen, are hidden as they say.
   */
  sync(objects: MapObject[], view: { players: boolean; obscured: boolean }) {
    this.objects = objects
    this.view = view
    const sight = view.players && view.obscured
    const ids = new Set(objects.map((o) => o.id))
    for (const [id, m] of this.meshes) {
      if (ids.has(id)) continue
      this.release(m.asset)
      m.mesh.destroy()
      this.meshes.delete(id)
    }
    objects.forEach((o, index) => {
      let m = this.meshes.get(o.id)
      if (m && m.asset !== o.asset) {
        this.release(m.asset)
        m.mesh.destroy()
        this.meshes.delete(o.id)
        m = undefined
      }
      if (!m) {
        const mesh = createObjectMesh(this.mapGroup)
        for (const slot of SHARED_SLOTS) mesh.setTexture(slot, this.shared[slot] ?? null)
        m = { mesh, asset: o.asset, placed: null }
        this.meshes.set(o.id, m)
        this.addChild(mesh.mesh)
        const l = this.acquire(o.asset)
        if (l?.source) mesh.setTexture('uObject', l.source)
      }
      if (m.placed !== o) {
        m.mesh.setCorners(objectCorners(o))
        m.placed = o
      }
      const unseen = sight && o.visibility === 'seen' && !o.seen
      const notShown = o.visibility === 'hidden' && !o.seen
      m.mesh.mesh.visible = !!this.loaded.get(o.asset)?.source && !unseen && !(notShown && view.players)
      m.mesh.mesh.alpha = notShown ? 0.4 : 1
      m.mesh.setSightOnly(sight && o.visibility === 'sight')
      // Draw order follows the scene's order.
      if (this.getChildIndex(m.mesh.mesh) !== index) this.setChildIndex(m.mesh.mesh, Math.min(index, this.children.length - 1))
    })
  }

  /** Step animations to time `seconds`. Returns whether anything changed. */
  animate(seconds: number): boolean {
    let changed = false
    for (const o of this.objects) {
      const f = this.images[o.asset]?.frames
      const m = this.meshes.get(o.id)
      if (!f || !m) continue
      const n = Math.floor(seconds * f.fps) % f.count
      const cw = f.frameWidth + 2 * f.pad
      const ch = f.frameHeight + 2 * f.pad
      const W = f.cols * cw
      const H = f.rows * ch
      const col = n % f.cols
      const row = Math.floor(n / f.cols)
      if (m.mesh.setFrame((col * cw + f.pad) / W, (row * ch + f.pad) / H, f.frameWidth / W, f.frameHeight / H)) {
        changed = true
      }
    }
    return changed
  }

  private acquire(key: string): LoadedImage | null {
    const image = this.images[key]
    if (!image) return null
    let l = this.loaded.get(key)
    if (!l) {
      l = { image, source: null, bitmap: null, users: 0 }
      this.loaded.set(key, l)
      const entry = l
      void createImageBitmap(image.image).then(
        (bitmap) => {
          if (this.loaded.get(key) !== entry) {
            bitmap.close()
            return
          }
          entry.bitmap = bitmap
          entry.source = new ImageSource({ resource: bitmap, autoGenerateMipmaps: true })
          for (const m of this.meshes.values()) {
            if (m.asset !== key) continue
            m.mesh.setTexture('uObject', entry.source)
          }
          this.sync(this.objects, this.view) // shown now, where it should be
          this.onChange()
        },
        () => {},
      )
    }
    l.users++
    return l
  }

  private release(key: string) {
    const l = this.loaded.get(key)
    if (!l) return
    if (--l.users <= 0) this.unload(key)
  }

  private unload(key: string) {
    const l = this.loaded.get(key)
    if (!l) return
    this.loaded.delete(key)
    l.source?.destroy()
    l.bitmap?.close()
    // Objects still showing this asset pick up the new image.
    for (const m of this.meshes.values()) {
      if (m.asset !== key) continue
      m.mesh.setTexture('uObject', null)
      const again = this.acquire(key)
      if (again?.source) m.mesh.setTexture('uObject', again.source)
    }
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    for (const m of this.meshes.values()) m.mesh.destroy()
    this.meshes.clear()
    for (const l of this.loaded.values()) {
      l.source?.destroy()
      l.bitmap?.close()
    }
    this.loaded.clear()
    super.destroy(options)
  }
}
