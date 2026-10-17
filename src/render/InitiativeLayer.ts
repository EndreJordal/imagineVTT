import { ColorMatrixFilter, Container, Graphics, Sprite, Text } from 'pixi.js'
import { oppositeEdge, type OrderEdge, type OrderEntry, type OrderFacing, type OrderStrip } from '../shared/combat'
import type { AssetImages } from '../shared/mapObjects'
import { PictureTextures } from './pictureTextures'

/**
 * The order of initiative on the table: a row of portrait coins along an edge of the screen
 * (and the opposite one, if chosen), reading from that edge's side of the table or from across
 * it. Whoever is acting is larger and glowing, those who have acted faded, those out of the
 * fight greyed. Each coin shows its initiative.
 */

/** A coin's diameter on the table (mm), and the bounds in pixels. */
const COIN_MM = 13
const MIN_PX = 30
const MAX_PX = 96
/** The acting coin is this much bigger. */
const ACTIVE_SCALE = 1.3
/** Gap from the screen's edge, as a fraction of a coin. */
const EDGE_GAP = 0.35
/** Room between coins, and for the turn at the start of the row, as fractions of a coin. */
const GAP = 0.55
const TURN_ROOM = 1.6
/** Room under the coins for names (two lines), as a fraction of a coin. */
const NAME_ROOM = 0.55

const ALLY = 0x3fae6a
const ENEMY = 0xc0392b
const PLAYER = 0x4a90d9

const PHASES: Record<string, string> = { setup: '', declare: 'Declaring', act: '', extra: 'Extra actions', end: '' }


export class InitiativeLayer extends Container {
  private strip: OrderStrip | null = null
  private pictures = new PictureTextures(() => this.rebuild())
  private screen = { width: 1920, height: 1080 }
  private pxPerMm = 4
  private glows: Graphics[] = []
  private grey = new ColorMatrixFilter()
  onChange: () => void = () => {}

  constructor() {
    super()
    this.grey.desaturate()
  }

  get animated() {
    return this.glows.length > 0
  }

  setImages(images: AssetImages) {
    this.pictures.setImages(images)
    this.rebuild()
  }

  setStrip(strip: OrderStrip | null) {
    this.strip = strip
    this.rebuild()
  }

  resize(width: number, height: number, pxPerMm: number) {
    if (width === this.screen.width && height === this.screen.height && pxPerMm === this.pxPerMm) return
    this.screen = { width, height }
    this.pxPerMm = pxPerMm
    this.rebuild()
  }

  animate(seconds: number) {
    const a = 0.55 + 0.45 * Math.sin(seconds * 4)
    for (const g of this.glows) g.alpha = a
  }

  private rebuild() {
    for (const child of this.removeChildren()) child.destroy({ children: true })
    this.glows = []
    const strip = this.strip
    if (strip && strip.entries.length) {
      const { edge, facing, both } = strip.placement
      this.addChild(this.row(strip, edge, facing))
      if (both) this.addChild(this.row(strip, oppositeEdge(edge), facing))
    }
    // Portraits no coin shows any more.
    this.pictures.keepOnly(new Set(strip?.entries.map((e) => e.portrait)))
    this.onChange()
  }

  /**
   * One row of coins along `edge`. Built around its own middle, then turned so it reads from
   * that edge's side of the table ('out') or from across it ('in'), and set against the edge.
   */
  private row(strip: OrderStrip, edge: OrderEdge, facing: OrderFacing): Container {
    const { width, height } = this.screen
    const along = edge === 'bottom' || edge === 'top' ? width : height
    const n = strip.entries.length
    const length = (size: number) => size * TURN_ROOM + n * size + (n - 1) * size * GAP + (ACTIVE_SCALE - 1) * size
    let d = Math.min(MAX_PX, Math.max(MIN_PX, COIN_MM * this.pxPerMm))
    // Fit the edge (most of it), shrinking the coins if the fight is big.
    if (length(d) > along * 0.94) d *= (along * 0.94) / length(d)
    const total = length(d)

    const row = new Container()
    const inner = new Container()
    const bg = new Graphics()
    row.addChild(bg, inner)

    // Turn and phase, at the start of the row.
    const phase = PHASES[strip.phase] ?? ''
    const turn = new Text({
      text: phase ? `Turn ${strip.round}\n${phase}` : `Turn ${strip.round}`,
      style: {
        fill: 0xe8e0c8,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontWeight: '700',
        fontSize: d * 0.3,
        align: 'center',
        stroke: { color: 0x000000, width: d * 0.06, join: 'round' },
      },
    })
    turn.anchor.set(0.5)
    turn.resolution = 2
    let x = -total / 2 + (d * TURN_ROOM) / 2
    turn.position.set(x, 0)
    inner.addChild(turn)
    x += (d * TURN_ROOM) / 2

    for (const e of strip.entries) {
      const size = e.active ? d * ACTIVE_SCALE : d
      x += size / 2
      inner.addChild(this.coin(e, size, x, d * (1 + GAP * 0.9)))
      x += size / 2 + d * GAP
    }

    // The row's box: the active coin's glow above, two lines of names below.
    const top = -(d * ACTIVE_SCALE) / 2 - d * 0.14
    const bottom = (d * ACTIVE_SCALE) / 2 + d * 0.08 + d * NAME_ROOM
    const pad = d * 0.22
    inner.y = -(top + bottom) / 2
    const h = bottom - top + 2 * pad
    bg.roundRect(-total / 2 - pad * 1.5, -h / 2, total + pad * 3, h, d * 0.3).fill({ color: 0x000000, alpha: 0.6 })

    // Turned to face its readers, then set against the edge.
    const quarter = Math.PI / 2
    const base: Record<OrderEdge, number> = { bottom: 0, top: 2 * quarter, left: quarter, right: -quarter }
    row.rotation = base[edge] + (facing === 'in' ? Math.PI : 0)
    const off = d * EDGE_GAP + h / 2
    const at: Record<OrderEdge, [number, number]> = {
      bottom: [width / 2, height - off],
      top: [width / 2, off],
      left: [off, height / 2],
      right: [width - off, height / 2],
    }
    row.position.set(...at[edge])
    return row
  }

  private coin(e: OrderEntry, d: number, x: number, nameWidth: number): Container {
    const r = d / 2
    const coin = new Container()
    coin.position.set(x, 0)
    const color = e.side === 'pc' ? PLAYER : e.allegiance === 'ally' ? ALLY : ENEMY

    if (e.active) {
      const glow = new Graphics()
        .circle(0, 0, r * 1.18)
        .stroke({ width: r * 0.18, color: 0xffc04d, alpha: 0.4 })
        .circle(0, 0, r * 1.07)
        .stroke({ width: r * 0.08, color: 0xffd98a })
      coin.addChild(glow)
      this.glows.push(glow)
    }

    const inner = r * 0.86
    coin.addChild(new Graphics().circle(0, 0, inner).fill(0x2a2730))
    const texture = e.portrait ? this.pictures.get(e.portrait) : null
    if (texture) {
      const pic = new Sprite({ texture, anchor: 0.5 })
      pic.scale.set((2 * inner) / Math.min(texture.width, texture.height))
      // Portraits are mostly heads at the top: show the upper part.
      pic.position.set(0, ((pic.height - 2 * inner) / 2) * 0.6)
      const mask = new Graphics().circle(0, 0, inner).fill(0xffffff)
      pic.mask = mask
      coin.addChild(pic, mask)
    } else {
      const letter = new Text({
        text: e.name.charAt(0).toUpperCase(),
        style: { fill: 0xd8d0c0, fontFamily: 'Georgia, serif', fontWeight: 'bold', fontSize: inner },
      })
      letter.anchor.set(0.5)
      coin.addChild(letter)
    }
    coin.addChild(new Graphics().circle(0, 0, r - r * 0.07).stroke({ width: r * 0.14, color }))

    // Initiative, on a badge at the coin's shoulder.
    if (e.init !== null) {
      const br = Math.max(9, r * 0.36)
      const bx = r * 0.74
      const by = -r * 0.74
      coin.addChild(new Graphics().circle(bx, by, br).fill(0x15151a).stroke({ width: Math.max(1.5, br * 0.16), color }))
      const num = new Text({
        text: String(e.init),
        style: { fill: 0xffffff, fontFamily: 'Segoe UI, Arial, sans-serif', fontWeight: '700', fontSize: br * 1.15 },
      })
      num.anchor.set(0.5)
      num.resolution = 2
      num.position.set(bx, by)
      coin.addChild(num)
    }

    // How far the acting combatant has moved this turn, on a badge at the other shoulder.
    if (e.moved !== undefined) {
      const h = Math.max(16, r * 0.62)
      const label = new Text({
        text: `${e.moved} yd`,
        style: { fill: 0xffe2a0, fontFamily: 'Segoe UI, Arial, sans-serif', fontWeight: '700', fontSize: h * 0.62 },
      })
      label.anchor.set(0.5)
      label.resolution = 2
      const w = Math.max(h, label.width + h * 0.6)
      const bx = -r * 0.74
      const by = -r * 0.74
      coin.addChild(
        new Graphics()
          .roundRect(bx - w / 2, by - h / 2, w, h, h / 2)
          .fill(0x15151a)
          .stroke({ width: Math.max(1.5, h * 0.08), color: 0xffc04d }),
      )
      label.position.set(bx, by)
      coin.addChild(label)
    }

    // The name below; a long one wraps onto a second line rather than shrinking.
    const size = Math.max(10, d * 0.22)
    const name = new Text({
      text: e.name,
      style: {
        fill: e.active ? 0xffe2a0 : 0xffffff,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontWeight: '700',
        fontSize: size,
        lineHeight: size * 1.05,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: nameWidth,
        stroke: { color: 0x000000, width: Math.max(2, d * 0.06), join: 'round' },
      },
    })
    name.anchor.set(0.5, 0)
    name.resolution = 2
    // Still too wide (one long word): shrink to fit.
    if (name.width > nameWidth) name.scale.set(nameWidth / name.width)
    name.position.set(0, r + r * 0.12)
    coin.addChild(name)

    if (e.down) {
      coin.filters = [this.grey]
      coin.alpha = 0.45
    } else if (e.acted && !e.active) {
      coin.alpha = 0.5
    }
    return coin
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    this.pictures.destroy()
    super.destroy(options)
  }
}
