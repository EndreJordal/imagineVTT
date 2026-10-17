import { Container, Graphics, Text } from 'pixi.js'
import { measureLabel, type Measure } from '../shared/measure'
import type { Point } from '../shared/types'

/** Line width and label size, in squares (sized with the map, so they read on the table). */
const WIDTH = 0.09
const LABEL = 0.42

const hex = (color: string) => parseInt(color.replace('#', ''), 16) || 0xffffff

/**
 * Measurements and drawings: lines and circles with their distance on a dark pill, and
 * freehand strokes. The kept ones (the floor's) and the one being drawn. Labels turn with
 * the character tokens' text, so they read from the same side.
 */
export class MeasureLayer extends Container {
  private lines = new Graphics()
  private labels = new Container()
  private kept: Measure[] = []
  private draft: Measure | null = null
  private grid = 100
  private turn = 0

  constructor() {
    super()
    this.addChild(this.lines, this.labels)
  }

  /** The floor's measurements, its square size, and the token text's quarter turns. */
  sync(kept: Measure[] | undefined, grid: number, turn: number) {
    const list = kept ?? []
    if (list === this.kept && grid === this.grid && turn === this.turn) return
    this.kept = list
    this.grid = grid
    this.turn = turn
    this.redraw()
  }

  setDraft(draft: Measure | null) {
    if (draft === this.draft) return
    this.draft = draft
    this.redraw()
  }

  private redraw() {
    const g = this.lines.clear()
    for (const t of this.labels.removeChildren()) t.destroy()
    for (const m of this.draft ? [...this.kept, this.draft] : this.kept) this.drawOne(g, m)
  }

  private drawOne(g: Graphics, m: Measure) {
    const s = this.grid
    const w = WIDTH * s
    const color = hex(m.color)
    const [a, b] = m.points
    if (!a) return
    const stroke = (fn: () => void) => {
      fn()
      g.stroke({ width: w * 1.9, color: 0x000000, alpha: 0.55, cap: 'round', join: 'round' })
      fn()
      g.stroke({ width: w, color, cap: 'round', join: 'round' })
    }
    if (m.shape === 'free') {
      if (m.points.length === 1) {
        g.circle(a.x, a.y, w * 0.6).fill(color)
        return
      }
      stroke(() => g.poly(m.points, false))
      return
    }
    if (!b) return
    const dot = (p: Point) => g.circle(p.x, p.y, w * 0.9).fill(color).stroke({ width: w * 0.4, color: 0x000000, alpha: 0.55 })
    if (m.shape === 'circle') {
      const r = Math.hypot(b.x - a.x, b.y - a.y)
      g.circle(a.x, a.y, r).fill({ color, alpha: 0.12 })
      stroke(() => g.circle(a.x, a.y, r))
      stroke(() => g.moveTo(a.x, a.y).lineTo(b.x, b.y))
      dot(a)
      this.addLabel(m, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      return
    }
    stroke(() => g.moveTo(a.x, a.y).lineTo(b.x, b.y))
    dot(a)
    dot(b)
    this.addLabel(m, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  }

  /** The distance on a dark pill at p. */
  private addLabel(m: Measure, p: Point) {
    const text = measureLabel(m, this.grid)
    if (!text) return
    const size = LABEL * this.grid
    const pill = new Container()
    const label = new Text({
      text,
      style: { fill: 0xffffff, fontFamily: 'Segoe UI, Arial, sans-serif', fontWeight: '700', fontSize: size },
    })
    label.anchor.set(0.5)
    label.resolution = 2
    const pad = size * 0.35
    const bg = new Graphics()
      .roundRect(-label.width / 2 - pad, -label.height / 2 - pad * 0.4, label.width + 2 * pad, label.height + pad * 0.8, size * 0.4)
      .fill({ color: 0x15151a, alpha: 0.85 })
      .stroke({ width: size * 0.08, color: hex(m.color) })
    pill.addChild(bg, label)
    pill.position.set(p.x, p.y)
    pill.rotation = (this.turn * Math.PI) / 2
    this.labels.addChild(pill)
  }
}
