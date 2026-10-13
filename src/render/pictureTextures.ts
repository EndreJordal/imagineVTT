/** Pictures as textures: decoded once, and freed when they change or nothing shows them. */
import { Texture } from 'pixi.js'
import type { AssetImages } from '../shared/mapObjects'

interface Loaded {
  image: Blob
  texture: Texture | null
  bitmap: ImageBitmap | null
}

/** The scene's pictures (portraits) by key, as textures for the layers that show them. */
export class PictureTextures {
  private images: AssetImages = {}
  private loaded = new Map<string, Loaded>()
  private ready: () => void
  private dropping: (key: string) => void

  /** `ready`: a texture came in. `dropping`: one is about to be freed (stop showing it). */
  constructor(ready: () => void, dropping: (key: string) => void = () => {}) {
    this.ready = ready
    this.dropping = dropping
  }

  /** New pictures: the textures of changed or removed ones are freed. */
  setImages(images: AssetImages) {
    this.images = images
    for (const [key, l] of this.loaded) if (images[key]?.image !== l.image) this.unload(key)
  }

  has(key: string | undefined): key is string {
    return !!key && !!this.images[key]
  }

  /** The texture for a picture (null while it decodes, or if there's no such picture). */
  get(key: string): Texture | null {
    const asset = this.images[key]
    if (!asset) return null
    let l = this.loaded.get(key)
    if (!l) {
      const entry: Loaded = { image: asset.image, texture: null, bitmap: null }
      l = entry
      this.loaded.set(key, entry)
      void createImageBitmap(asset.image).then(
        (bitmap) => {
          if (this.loaded.get(key) !== entry) return bitmap.close()
          entry.bitmap = bitmap
          entry.texture = Texture.from(bitmap)
          this.ready()
        },
        () => {},
      )
    }
    return l.texture
  }

  /** Free the textures of pictures not in `used`. */
  keepOnly(used: Set<string | null | undefined>) {
    for (const key of [...this.loaded.keys()]) if (!used.has(key)) this.unload(key)
  }

  destroy() {
    for (const key of [...this.loaded.keys()]) this.unload(key)
  }

  private unload(key: string) {
    const l = this.loaded.get(key)
    if (!l) return
    this.dropping(key)
    this.loaded.delete(key)
    l.texture?.destroy(true)
    l.bitmap?.close()
  }
}

/** The app's own pictures (in public/), loaded once and kept (null while loading). */
const fixed = new Map<string, Texture | null>()

export function fixedTexture(path: string, loaded: () => void): Texture | null {
  if (fixed.has(path)) return fixed.get(path)!
  fixed.set(path, null)
  void fetch(`${import.meta.env.BASE_URL}${path}`)
    .then((r) => r.blob())
    .then((b) => createImageBitmap(b))
    .then((bitmap) => {
      fixed.set(path, Texture.from(bitmap))
      loaded()
    })
    .catch(() => fixed.delete(path))
  return null
}
