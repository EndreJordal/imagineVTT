import { ColorMatrixFilter, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import {
  BORDERS,
  PLAIN_RING,
  portraitRadius,
  slideOf,
  tokenDiameter,
  type CharacterToken,
} from '../shared/characters'
import type { AssetImages } from '../shared/mapObjects'
import type { Point, Scene } from '../shared/types'

/**
 * Character tokens: a border around a portrait, sliding to where they're moved. The players
 * see the ones they can see; the GM sees all, greyed where the players can't.
 */

interface Shown {
  root: Container
  portrait: Sprite
  mask: Graphics
  fill: Graphics
  initial: Text
  ring: Sprite
  plain: Graphics
  highlight: Graphics
  /** Where it's drawn, and the slide it's on (start set on the next frame). */
  at: Point
  slide: { from: Point; to: Point; start: number | null; duration: number } | null
  portraitKey?: string
}

/** Decoded portraits, by image key, shared by the tokens showing them. */
interface Loaded {
  image: Blob
  texture: Texture | null
  bitmap: ImageBitmap | null
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Border pictures, loaded once (null while loading). */
const borderTextures = new Map<string, Texture | null>()

function borderTexture(id: string, loaded: () => void): Texture | null {
  if (borderTextures.has(id)) return borderTextures.get(id)!
  borderTextures.set(id, null)
  void fetch(`${import.meta.env.BASE_URL}borders/${id}.png`)
    .then((r) => r.blob())
    .then((b) => createImageBitmap(b))
    .then((bitmap) => {
      borderTextures.set(id, Texture.from(bitmap))
      loaded()
    })
    .catch(() => borderTextures.delete(id))
  return null
}

export class CharacterLayer extends Container {
  private shown = new Map<string, Shown>()
  private images: AssetImages = {}
  private loaded = new Map<string, Loaded>()
  private grey = new ColorMatrixFilter()
  /** The GM's selected token, ringed. */
  private selectedId: string | null = null
  /** One GM screen pixel in scene units, for the selection ring's width. */
  private px = 1
  /** The last sync's scene, to redraw when a border picture comes in. */
  private last: { scene: Scene; seen: Set<string>; players: boolean } | null = null
  onChange: () => void = () => {}

  constructor() {
    super()
    this.grey.desaturate()
  }

  get animated() {
    for (const s of this.shown.values()) if (s.slide) return true
    return false
  }

  setImages(images: AssetImages) {
    this.images = images
    for (const [key, l] of this.loaded) {
      if (images[key]?.image !== l.image) this.unload(key)
    }
  }

  /**
   * `seen`: the tokens the players can see. For the players, only those are drawn; for the
   * GM, all are, the others greyed.
   */
  sync(scene: Scene, seen: Set<string>, players: boolean) {
    this.last = { scene, seen, players }
    const tokens = scene.characters ?? []
    const ids = new Set(tokens.map((t) => t.id))
    for (const [id, s] of this.shown) {
      if (ids.has(id)) continue
      s.root.destroy({ children: true })
      this.shown.delete(id)
    }
    for (const t of tokens) {
      let s = this.shown.get(t.id)
      if (!s) s = this.create(t)
      else if (s.slide ? s.slide.to.x !== t.x || s.slide.to.y !== t.y : s.at.x !== t.x || s.at.y !== t.y) {
        // Moved: slide there from where it is now (mid-slide too).
        const duration = slideOf(t, scene)
        s.slide = duration > 0 ? { from: { ...s.at }, to: { x: t.x, y: t.y }, start: null, duration } : null
        if (!s.slide) s.at = { x: t.x, y: t.y }
      }
      const visible = seen.has(t.id)
      s.root.visible = !players || visible
      s.root.alpha = players || visible ? 1 : 0.55
      s.root.filters = players || visible ? null : [this.grey]
      this.draw(s, t, scene)
    }
    this.cleanUnused()
  }

  animate(seconds: number) {
    for (const s of this.shown.values()) {
      const slide = s.slide
      if (!slide) continue
      slide.start ??= seconds
      const k = Math.min(1, (seconds - slide.start) / slide.duration)
      const e = ease(k)
      s.at = { x: slide.from.x + (slide.to.x - slide.from.x) * e, y: slide.from.y + (slide.to.y - slide.from.y) * e }
      s.root.position.set(s.at.x, s.at.y)
      if (k >= 1) s.slide = null
    }
  }

  /** Ring the GM's selected token (null: none); `px` is a screen pixel in scene units. */
  select(id: string | null, px: number) {
    if (id === this.selectedId && px === this.px) return
    this.selectedId = id
    this.px = px
    if (this.last) this.sync(this.last.scene, this.last.seen, this.last.players)
  }

  /** Where a token is drawn right now (mid-slide, between its places). */
  drawnAt(id: string): Point | null {
    return this.shown.get(id)?.at ?? null
  }

  private create(t: CharacterToken): Shown {
    const root = new Container()
    const fill = new Graphics()
    const portrait = new Sprite({ anchor: 0.5 })
    const mask = new Graphics()
    const initial = new Text({ text: '', style: { fill: 0xd8d0c0, fontFamily: 'Georgia, serif', fontWeight: 'bold' } })
    initial.anchor.set(0.5)
    const plain = new Graphics()
    const ring = new Sprite({ anchor: 0.5 })
    const highlight = new Graphics()
    portrait.mask = mask
    root.addChild(fill, initial, portrait, mask, plain, ring, highlight)
    this.addChild(root)
    const s: Shown = { root, portrait, mask, fill, initial, ring, plain, highlight, at: { x: t.x, y: t.y }, slide: null }
    this.shown.set(t.id, s)
    return s
  }

  private draw(s: Shown, t: CharacterToken, scene: Scene) {
    const r = tokenDiameter(t, scene) / 2
    if (!s.slide) s.at = { x: t.x, y: t.y }
    s.root.position.set(s.at.x, s.at.y)
    const inner = r * portraitRadius(t.border)
    s.highlight.clear()
    if (t.id === this.selectedId) {
      s.highlight.circle(0, 0, r + 3 * this.px).stroke({ width: 2.5 * this.px, color: 0xffffff })
      s.highlight.circle(0, 0, r + 5.5 * this.px).stroke({ width: 1.5 * this.px, color: 0x000000, alpha: 0.6 })
    }
    s.fill.clear().circle(0, 0, inner).fill(0x2a2730)
    s.mask.clear().circle(0, 0, inner).fill(0xffffff)

    // The portrait, covering the frame's inside (zoomed and moved as set).
    const key = t.portrait && this.images[t.portrait] ? t.portrait : undefined
    s.portraitKey = key
    const loaded = key ? this.load(key) : null
    if (loaded?.texture) {
      const tex = loaded.texture
      s.portrait.texture = tex
      s.portrait.visible = true
      const scale = ((2 * inner) / Math.min(tex.width, tex.height)) * Math.max(0.1, t.zoom)
      s.portrait.scale.set(scale)
      s.portrait.position.set(t.offsetX * 2 * inner, t.offsetY * 2 * inner)
      s.initial.visible = false
    } else {
      s.portrait.visible = false
      s.initial.visible = true
      s.initial.text = t.name.trim().charAt(0).toUpperCase()
      s.initial.style.fontSize = Math.max(4, inner)
    }

    // The border: a picture, or a plain ring in the chosen colour.
    const picture = BORDERS.some((b) => b.id === t.border)
    s.plain.clear()
    if (picture) {
      const tex = borderTexture(t.border, () => {
        if (this.destroyed || !this.last) return
        this.sync(this.last.scene, this.last.seen, this.last.players)
        this.onChange()
      })
      s.ring.visible = !!tex
      if (tex) {
        s.ring.texture = tex
        s.ring.setSize(2 * r)
      }
    } else {
      s.ring.visible = false
      const w = r * PLAIN_RING
      s.plain
        .circle(0, 0, r - w / 2)
        .stroke({ width: w, color: t.color })
        .circle(0, 0, r)
        .stroke({ width: Math.max(1, r * 0.03), color: 0x000000, alpha: 0.6 })
        .circle(0, 0, r - w)
        .stroke({ width: Math.max(1, r * 0.02), color: 0x000000, alpha: 0.5 })
    }
  }

  private load(key: string): Loaded {
    let l = this.loaded.get(key)
    if (l) return l
    const image = this.images[key].image
    const entry: Loaded = { image, texture: null, bitmap: null }
    this.loaded.set(key, entry)
    void createImageBitmap(image).then(
      (bitmap) => {
        if (this.loaded.get(key) !== entry) return bitmap.close()
        entry.bitmap = bitmap
        entry.texture = Texture.from(bitmap)
        this.onChange()
      },
      () => {},
    )
    return entry
  }

  private unload(key: string) {
    const l = this.loaded.get(key)
    if (!l) return
    this.loaded.delete(key)
    for (const s of this.shown.values()) {
      if (s.portraitKey === key) s.portrait.texture = Texture.EMPTY
    }
    l.texture?.destroy(true)
    l.bitmap?.close()
  }

  /** Portraits no token shows any more. */
  private cleanUnused() {
    const used = new Set([...this.shown.values()].map((s) => s.portraitKey))
    for (const key of [...this.loaded.keys()]) if (!used.has(key)) this.unload(key)
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    for (const key of [...this.loaded.keys()]) this.unload(key)
    super.destroy(options)
  }
}
