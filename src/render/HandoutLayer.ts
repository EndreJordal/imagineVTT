import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import { HANDOUT_FRAME, handoutBox, type Turn } from '../shared/handout'

/**
 * A picture shown to the players: framed, centred over everything on the table, turned to
 * face whoever it's for. Fades in and out; a new picture crossfades over the old one.
 */

/** Fade time, seconds. */
const FADE = 0.5
/** Pictures bigger than this (px, longest side) are scaled down: 4K is plenty for a TV. */
const MAX_PX = 3840

interface Shown {
  id: string
  turn: Turn
  fill: boolean
  /** The part of the picture shown (all of it, unless filling the screen crops it). */
  crop: Texture | null
  root: Container
  sprite: Sprite
  frame: Graphics
  texture: Texture
  bitmap: ImageBitmap
  /** 0..1 fade; heading for `target`. */
  alpha: number
  target: number
}

export class HandoutLayer extends Container {
  private shown: Shown[] = []
  private screen = { width: 1920, height: 1080 }
  private loading = 0
  private last: number | null = null
  onChange: () => void = () => {}

  get animated() {
    return this.shown.some((s) => s.alpha !== s.target)
  }

  /** Show a picture (null: hide). The same picture again just turns. */
  set(handout: { id: string; image: Blob; turn: Turn; fill: boolean } | null, instant = false) {
    const top = this.shown.at(-1)
    if (handout && top && top.id === handout.id && top.target === 1) {
      top.turn = handout.turn
      top.fill = handout.fill
      this.place(top)
      this.onChange()
      return
    }
    for (const s of this.shown) s.target = 0
    const load = ++this.loading
    if (!handout) {
      if (instant) for (const s of this.shown) s.alpha = 0
      this.onChange()
      return
    }
    void picture(handout.image).then((bitmap) => {
      if (!bitmap) return
      if (load !== this.loading) return bitmap.close()
      const texture = Texture.from(bitmap)
      const root = new Container()
      const frame = new Graphics()
      const sprite = new Sprite({ texture, anchor: 0.5 })
      root.addChild(frame, sprite)
      this.addChild(root)
      const s: Shown = {
        id: handout.id,
        turn: handout.turn,
        fill: handout.fill,
        crop: null,
        root,
        sprite,
        frame,
        texture,
        bitmap,
        alpha: instant ? 1 : 0,
        target: 1,
      }
      this.shown.push(s)
      this.place(s)
      this.onChange()
    })
  }

  resize(width: number, height: number) {
    if (width === this.screen.width && height === this.screen.height) return
    this.screen = { width, height }
    for (const s of this.shown) this.place(s)
  }

  /** Step the fades to time `seconds` (the table's clock). */
  animate(seconds: number) {
    const dt = this.last === null ? 1 / 30 : Math.min(0.1, Math.max(0, seconds - this.last))
    for (const s of this.shown) {
      if (s.alpha === s.target) continue
      const d = dt / FADE
      s.alpha = s.target > s.alpha ? Math.min(s.target, s.alpha + d) : Math.max(s.target, s.alpha - d)
      s.root.alpha = s.alpha * s.alpha * (3 - 2 * s.alpha)
    }
    // Faded out: let go.
    for (const s of this.shown.filter((x) => x.target === 0 && x.alpha === 0)) {
      this.shown.splice(this.shown.indexOf(s), 1)
      s.root.destroy({ children: true })
      s.crop?.destroy()
      s.texture.destroy(true)
      s.bitmap.close()
    }
    // Between fades the clock restarts, so a new fade doesn't jump ahead.
    this.last = this.animated ? seconds : null
  }

  private place(s: Shown) {
    const { width: w, height: h } = s.bitmap
    const box = handoutBox(this.screen, { width: w, height: h }, s.turn, s.fill)
    s.root.position.set(this.screen.width / 2, this.screen.height / 2)
    s.root.rotation = (s.turn * Math.PI) / 2
    s.root.alpha = s.alpha * s.alpha * (3 - 2 * s.alpha)
    const f = HANDOUT_FRAME
    // The picture inside the frame, unturned (the root turns it, and the frame, together).
    const sideways = s.turn % 2 === 1
    const pw = (sideways ? box.height : box.width) - 2 * f
    const ph = (sideways ? box.width : box.height) - 2 * f
    // Filling the screen crops the picture to the frame: the middle of it.
    const cw = Math.min(w, pw / box.scale)
    const ch = Math.min(h, ph / box.scale)
    s.crop?.destroy()
    s.crop =
      cw < w - 0.5 || ch < h - 0.5
        ? new Texture({ source: s.texture.source, frame: new Rectangle((w - cw) / 2, (h - ch) / 2, cw, ch) })
        : null
    s.sprite.texture = s.crop ?? s.texture
    s.sprite.scale.set(box.scale)
    const g = s.frame.clear()
    // A soft shadow, then the dark frame, then a thin light edge around the picture.
    for (let i = 6; i >= 1; i--) {
      const r = f + i * 5
      g.roundRect(-pw / 2 - r, -ph / 2 - r + 6, pw + 2 * r, ph + 2 * r, 10 + i * 4).fill({ color: 0x000000, alpha: 0.07 })
    }
    g.roundRect(-pw / 2 - f, -ph / 2 - f, pw + 2 * f, ph + 2 * f, 8).fill(0x1c1a17).stroke({ width: 1.5, color: 0x5a5245 })
    g.rect(-pw / 2 - 2, -ph / 2 - 2, pw + 4, ph + 4).fill(0xd8c9a3)
  }
}

async function picture(blob: Blob): Promise<ImageBitmap | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = MAX_PX / Math.max(bitmap.width, bitmap.height)
    if (scale >= 1) return bitmap
    const scaled = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * scale),
      resizeHeight: Math.round(bitmap.height * scale),
      resizeQuality: 'high',
    })
    bitmap.close()
    return scaled
  } catch {
    return null
  }
}
