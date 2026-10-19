import { isProne, shownConditions } from '../shared/combat'
import { conditionTags } from './conditionTags'
import { ColorMatrixFilter, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import {
  BORDERS,
  labelLines,
  PLAIN_RING,
  portraitRadius,
  slideOf,
  tokenDiameter,
  type CharacterToken,
} from '../shared/characters'
import type { AssetImages } from '../shared/mapObjects'
import type { Point, Scene } from '../shared/types'
import { fixedTexture, PictureTextures } from './pictureTextures'

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
  /** The name and type, written at the bottom of the token's square(s). */
  labels: { name: Label; type: Label }
  ring: Sprite
  plain: Graphics
  highlight: Graphics
  /** The glow round whoever is acting in the linked fight. */
  glow: Graphics
  /** Its conditions as word tags, stacked up from the token's top edge. */
  tags: Container
  /** Where it's drawn, and the slide it's on (start set on the next frame). */
  at: Point
  slide: { from: Point; to: Point; start: number | null; duration: number } | null
  /** What it was last drawn from: drawn again only when any of it changes. */
  drawn: Drawn | null
  greyed: boolean
  portraitKey?: string
}

/** Decoded portraits, by image key, shared by the tokens showing them. */
interface Drawn {
  t: CharacterToken
  grid: number
  squareMm: number
  turn: number
  selected: boolean
  px: number
  active: boolean
  version: number
  players: boolean
}

const sameDrawn = (a: Drawn | null, b: Drawn) =>
  !!a && (Object.keys(b) as (keyof Drawn)[]).every((k) => a[k] === b[k])


/** Label colours: the name white, the type gold; both outlined in black. */
const NAME_COLOR = 0xffffff
const TYPE_COLOR = 0xffd166
/** Outline width (a fraction of the text height; half of it shows outside the letters). */
const OUTLINE = 0.26
/** The size labels are made at (and so already styled for). */
const START_SIZE = 20
/** Pushes the text down onto the square's bottom edge: the text box has room under the letters. */
const BOTTOM_NUDGE = 0.12
/** Distance between a name's and a type's baselines, as a fraction of the text height. */
const LINE_PITCH = 0.86
/** Label text height, as a fraction of a square. */
const LABEL_SIZE = 0.2

/** The shortest a label shrinks to fit its square (a fraction of full size); past that it's cut short. */
const MIN_LABEL_SCALE = 0.4

/**
 * A line of label text: the black outline (`back`) and the lettering over it (`front`).
 * Outlines and lettering are separate texts, so every outline sits under every letter:
 * one line's outline can't cover the other line's letters.
 */
interface Label {
  back: Text
  front: Text
}

/** Set a label's text and size, cut short with … if it won't fit the width; returns its scale. */
function fitLabel(label: Label, full: string, size: number, width: number): number {
  const text = label.back
  if (text.style.fontSize !== size) {
    for (const t of [label.back, label.front]) {
      t.style.fontSize = size
      t.style.lineHeight = size
      t.style.stroke = strokeOf(t === label.back, size)
    }
  }
  const measure = (value: string) => {
    for (const t of [label.back, label.front]) {
      if (t.text !== value) t.text = value
      t.scale.set(1)
    }
    return text.width
  }
  let w = measure(full)
  if (w <= width) return 1
  if (width / w >= MIN_LABEL_SCALE) return width / w
  // Too long even shrunk: keep the start, as many characters as fit, and an ellipsis.
  let n = Math.max(1, Math.floor((full.length * width) / (w * MIN_LABEL_SCALE)))
  let cut = `${full.slice(0, n).trimEnd()}…`
  w = measure(cut)
  while (w * MIN_LABEL_SCALE > width && n > 1) {
    cut = `${full.slice(0, --n).trimEnd()}…`
    w = measure(cut)
  }
  return Math.min(1, width / w)
}

/**
 * The outline's stroke; the lettering over it has the same stroke, invisible, so both texts
 * measure and sit alike.
 */
function strokeOf(visible: boolean, size: number) {
  return { color: 0x000000, width: size * OUTLINE, join: 'round' as const, alpha: visible ? 1 : 0 }
}

function labelText(fill: number): Label {
  const make = (color: number, outline: boolean) => {
    const text = new Text({
      text: '',
      style: {
        fill: color,
        fontFamily: 'Segoe UI, Arial, sans-serif',
        fontWeight: '700',
        fontSize: START_SIZE,
        lineHeight: START_SIZE,
        // Styled from the start: fitLabel only restyles when the size changes.
        stroke: strokeOf(outline, START_SIZE),
      },
    })
    text.anchor.set(0.5, 1)
    // Rasterised sharp enough for the table and a zoomed-in GM view.
    text.resolution = 3
    text.visible = false
    return text
  }
  return { back: make(0x000000, true), front: make(fill, false) }
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export class CharacterLayer extends Container {
  private shown = new Map<string, Shown>()
  private pictures = new PictureTextures(
    () => this.redraw(),
    // Tokens stop showing a portrait before it's freed.
    (key) => {
      for (const s of this.shown.values()) if (s.portraitKey === key) s.portrait.texture = Texture.EMPTY
    },
  )
  private grey = new ColorMatrixFilter()
  /** The GM's selected token, ringed. */
  /** The GM's selected tokens, ringed (a key of their ids, to see a change). */
  private selected = new Set<string>()
  private selectedKey = ''
  /** The combatant acting in the linked fight: its token glows. */
  private activeRef: string | null = null
  /** One GM screen pixel in scene units, for the selection ring's width. */
  private px = 1
  /** The last sync's scene, to redraw when a border picture comes in. */
  private last: { scene: Scene; seen: Set<string>; players: boolean } | null = null
  /** Goes up when pictures come in or change, so the tokens showing them are drawn again. */
  private version = 0
  onChange: () => void = () => {}

  constructor() {
    super()
    this.grey.desaturate()
  }

  get animated() {
    for (const s of this.shown.values()) if (s.slide || s.glow.visible) return true
    return false
  }

  setImages(images: AssetImages) {
    this.pictures.setImages(images)
    // Portraits that came in after the tokens were drawn (a reload, a fetched portrait).
    this.redraw()
  }

  /** Draw the tokens again: pictures came in or changed. */
  private redraw() {
    this.version++
    if (this.last) this.sync(this.last.scene, this.last.seen, this.last.players)
    this.onChange()
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
      // Greyed: out of the fight (dead, in torpor…); and, for the GM, what the players can't see.
      const greyed = !!t.down || (!players && !visible)
      s.root.alpha = (players || visible ? 1 : 0.55) * (t.down ? 0.7 : 1)
      if (greyed !== s.greyed) s.root.filters = greyed ? [this.grey] : null
      s.greyed = greyed
      const selected = this.selected.has(t.id)
      const drawn: Drawn = {
        t,
        grid: scene.grid.size,
        squareMm: scene.squareMm,
        turn: scene.characterTurn ?? 0,
        selected,
        px: selected ? this.px : 0,
        active: !!t.ref && t.ref === this.activeRef,
        version: this.version,
        players,
      }
      if (sameDrawn(s.drawn, drawn)) continue
      s.drawn = drawn
      this.draw(s, t, scene)
    }
    this.pictures.keepOnly(new Set([...this.shown.values()].map((s) => s.portraitKey)))
  }

  animate(seconds: number) {
    for (const s of this.shown.values()) {
      if (s.glow.visible) s.glow.alpha = 0.55 + 0.45 * Math.sin(seconds * 4)
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

  /** Glow round the token of whoever is acting in the linked fight (the combatant's id; null: none). */
  setActive(ref: string | null) {
    if (ref === this.activeRef) return
    this.activeRef = ref
    if (this.last) this.sync(this.last.scene, this.last.seen, this.last.players)
    this.onChange()
  }

  /** Ring the GM's selected tokens; `px` is a screen pixel in scene units. */
  select(ids: string[], px: number) {
    const key = ids.join(',')
    if (key === this.selectedKey && px === this.px) return
    this.selectedKey = key
    this.selected = new Set(ids)
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
    const glow = new Graphics()
    glow.visible = false
    const labels = { name: labelText(NAME_COLOR), type: labelText(TYPE_COLOR) }
    const tags = new Container()
    portrait.mask = mask
    // All the outlines, then all the lettering.
    root.addChild(glow, fill, initial, portrait, mask, plain, ring, highlight)
    root.addChild(labels.name.back, labels.type.back, labels.name.front, labels.type.front, tags)
    this.addChild(root)
    const s: Shown = { root, portrait, mask, fill, initial, labels, ring, plain, highlight, glow, tags, at: { x: t.x, y: t.y }, slide: null, drawn: null, greyed: false }
    this.shown.set(t.id, s)
    return s
  }

  private draw(s: Shown, t: CharacterToken, scene: Scene) {
    const r = tokenDiameter(t, scene) / 2
    if (!s.slide) s.at = { x: t.x, y: t.y }
    s.root.position.set(s.at.x, s.at.y)
    // Whoever is acting: a warm glow round the token (pulsing; see animate).
    s.glow.clear()
    s.glow.visible = !!t.ref && t.ref === this.activeRef
    if (s.glow.visible) {
      s.glow
        .circle(0, 0, r * 1.16)
        .stroke({ width: r * 0.16, color: 0xffc04d, alpha: 0.35 })
        .circle(0, 0, r * 1.06)
        .stroke({ width: r * 0.08, color: 0xffd98a, alpha: 0.95 })
    }
    // The whole token turns: border, portrait and text, to face whoever it's for.
    s.root.rotation = ((scene.characterTurn ?? 0) * Math.PI) / 2
    const inner = r * portraitRadius(t.border)
    s.highlight.clear()
    if (this.selected.has(t.id)) {
      s.highlight.circle(0, 0, r + 3 * this.px).stroke({ width: 2.5 * this.px, color: 0xffffff })
      s.highlight.circle(0, 0, r + 5.5 * this.px).stroke({ width: 1.5 * this.px, color: 0x000000, alpha: 0.6 })
    }
    s.fill.clear().circle(0, 0, inner).fill(0x2a2730)
    s.mask.clear().circle(0, 0, inner).fill(0xffffff)

    // The portrait, covering the frame's inside (zoomed and moved as set).
    const key = this.pictures.has(t.portrait) ? t.portrait : undefined
    s.portraitKey = key
    const tex = key ? this.pictures.get(key) : null
    if (tex) {
      s.portrait.texture = tex
      s.portrait.visible = true
      const scale = ((2 * inner) / Math.min(tex.width, tex.height)) * Math.max(0.1, t.zoom)
      s.portrait.scale.set(scale)
      // Prone: the portrait lies on its side (turned a quarter, its offset with it).
      const ox = t.offsetX * 2 * inner
      const oy = t.offsetY * 2 * inner
      const prone = isProne(t.conditions)
      s.portrait.rotation = prone ? Math.PI / 2 : 0
      if (prone) s.portrait.position.set(-oy, ox)
      else s.portrait.position.set(ox, oy)
      s.initial.visible = false
    } else {
      s.portrait.visible = false
      s.initial.visible = true
      s.initial.text = t.name.trim().charAt(0).toUpperCase()
      s.initial.style.fontSize = Math.max(4, inner)
      s.initial.rotation = isProne(t.conditions) ? Math.PI / 2 : 0
    }

    // Conditions: word tags stacked up from the token's top edge (the players don't see secret ones).
    for (const c of s.tags.removeChildren()) c.destroy({ children: true })
    const shown = shownConditions(t.conditions, this.last?.players ?? false)
    if (shown.length) {
      const stack = conditionTags(shown, r * 0.34, -1)
      stack.position.set(0, -r + r * 0.17)
      s.tags.addChild(stack)
    }

    this.drawLabels(s, t, scene)

    // The border: a picture, or a plain ring in the chosen colour.
    const picture = BORDERS.some((b) => b.id === t.border)
    s.plain.clear()
    if (picture) {
      const tex = fixedTexture(`borders/${t.border}.png`, () => {
        if (!this.destroyed) this.redraw()
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

  /**
   * The name and/or type, at the bottom of the square(s) the token occupies: outlined so
   * they read over any map; the name on top in white, the type below it in gold.
   */
  private drawLabels(s: Shown, t: CharacterToken, scene: Scene) {
    const lines = labelLines(t)
    const square = t.size * scene.grid.size
    const size = scene.grid.size * LABEL_SIZE * (t.size === 2 ? 1.25 : 1)
    // The last line's glyphs sit right on the square's bottom edge (outline included).
    const bottom = square / 2 + size * BOTTOM_NUDGE
    for (const l of [s.labels.name, s.labels.type]) l.back.visible = l.front.visible = false
    // The last line sits on the bottom edge; the one above it stacks over it.
    lines
      .slice()
      .reverse()
      .forEach((line, i) => {
        const label = s.labels[line.kind]
        const fits = fitLabel(label, line.text, size, square * 0.96)
        for (const text of [label.back, label.front]) {
          text.scale.set(fits)
          text.position.set(0, bottom - i * size * LINE_PITCH)
          text.visible = true
        }
      })
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    this.pictures.destroy()
    super.destroy(options)
  }
}
