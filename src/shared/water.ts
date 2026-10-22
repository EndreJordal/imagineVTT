/**
 * Water: areas the GM paints over the map's water (a canal, a puddle, a flooded basement)
 * that bring it to life on the table: ripples bending the picture, slow waves, a flow one
 * way, an optional tint, soft edges, and a sound heard near any part of it. Masks on the
 * hidden areas' grid (see hidden.ts), so they stay with the map when it's moved or scaled.
 */
import { decodeHidden, editableGrid, type HiddenMask } from './hidden'
import type { Point, Rect } from './types'

/** A sound heard near the water: loudest beside it, silent `range` squares away. */
export interface WaterSound {
  clip: string
  /** 0..1 beside the water. */
  volume: number
  /** Squares from the water's edge. */
  range: number
}

export interface WaterArea {
  id: string
  name: string
  cells: HiddenMask
  /** How far the edges blend into the map, in squares. */
  softness: number
  /** Small ripples bending the picture (0..1). */
  ripple: number
  /** Slow, larger swells with soft bright crests (0..1). */
  waves: number
  /** How fast it flows (0: still water; 1: a fast river). */
  flow: number
  /** The way it flows, in degrees clockwise from right (east). */
  direction: number
  /** A colour the water takes on, '#rrggbb'... */
  color: string
  /** ...and how much (0: the map's own colours). */
  tint: number
  sound?: WaterSound | null
  /** Switched off (kept, not drawn); absent means on. */
  active?: boolean
  group?: string
}

export const DEFAULT_WATER: Omit<WaterArea, 'id' | 'name' | 'cells'> = {
  softness: 0.5,
  ripple: 0.5,
  waves: 0.2,
  flow: 0,
  direction: 0,
  color: '#2f6b80',
  tint: 0,
}

/** At most this many water areas show on a floor (the shader's limit); later ones don't. */
export const MAX_WATER = 8

export const activeWater = (areas: WaterArea[] | undefined): WaterArea[] =>
  (areas ?? []).filter((a) => a.active !== false).slice(0, MAX_WATER)

const masks = new WeakMap<HiddenMask, Uint8Array>()

/** An area's cells, decoded (kept while the area's cells are unchanged). */
function cellsOf(area: WaterArea): Uint8Array {
  let m = masks.get(area.cells)
  if (!m) {
    m = decodeHidden(area.cells)
    masks.set(area.cells, m)
  }
  return m
}

/** Whether p is in the water. */
export function inWater(area: WaterArea, bounds: Rect, p: Point): boolean {
  const { cols, rows } = area.cells
  const x = Math.floor(((p.x - bounds.x) / bounds.width) * cols)
  const y = Math.floor(((p.y - bounds.y) / bounds.height) * rows)
  return x >= 0 && y >= 0 && x < cols && y < rows && !!cellsOf(area)[y * cols + x]
}

/** The water at p, topmost first. */
export const waterAt = (areas: WaterArea[] | undefined, bounds: Rect, p: Point) =>
  [...(areas ?? [])].reverse().find((a) => inWater(a, bounds, p))

/**
 * How far p is from the water, in scene units (0 inside it), looking no further than
 * `limit` (beyond it: Infinity). Only the cells within reach are looked at.
 */
export function waterDistance(area: WaterArea, bounds: Rect, p: Point, limit: number): number {
  const { cols, rows } = area.cells
  const cw = bounds.width / cols
  const ch = bounds.height / rows
  const mask = cellsOf(area)
  const px = (p.x - bounds.x) / cw
  const py = (p.y - bounds.y) / ch
  const x0 = Math.max(0, Math.floor(px - limit / cw))
  const x1 = Math.min(cols - 1, Math.ceil(px + limit / cw))
  const y0 = Math.max(0, Math.floor(py - limit / ch))
  const y1 = Math.min(rows - 1, Math.ceil(py + limit / ch))
  let best = Infinity
  for (let y = y0; y <= y1; y++) {
    const row = y * cols
    for (let x = x0; x <= x1; x++) {
      if (!mask[row + x]) continue
      // To the cell's nearest edge (0 inside it).
      const dx = Math.max(0, Math.abs(px - (x + 0.5)) - 0.5) * cw
      const dy = Math.max(0, Math.abs(py - (y + 0.5)) - 0.5) * ch
      const d = Math.hypot(dx, dy)
      if (d < best) {
        best = d
        if (d === 0) return 0
      }
    }
  }
  return best <= limit ? best : Infinity
}

/** How loud the water's sound is for these listeners (0..1, as `hearing` for map sounds). */
export function waterHearing(area: WaterArea, bounds: Rect, listeners: Point[], gridSize: number): number {
  const range = (area.sound?.range ?? 0) * gridSize
  if (range <= 0) return 0
  let best = 0
  for (const l of listeners) {
    const d = waterDistance(area, bounds, l, range) / range
    if (d < 1) best = Math.max(best, (1 - d) * (1 - d))
  }
  return best
}

const middles = new WeakMap<HiddenMask, { u: number; v: number }>()

/** The water's middle, for its token: the middle of its cells (worked out once per shape). */
export function waterCentre(area: WaterArea, bounds: Rect): Point {
  let m = middles.get(area.cells)
  if (!m) {
    const { cols, rows } = area.cells
    const mask = cellsOf(area)
    let sx = 0
    let sy = 0
    let n = 0
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!mask[y * cols + x]) continue
        sx += x
        sy += y
        n++
      }
    }
    m = n ? { u: (sx / n + 0.5) / cols, v: (sy / n + 0.5) / rows } : { u: 0.5, v: 0.5 }
    middles.set(area.cells, m)
  }
  return { x: bounds.x + m.u * bounds.width, y: bounds.y + m.v * bounds.height }
}

/** A grid to paint an area's cells into (the hidden areas' brush works on it). */
export const waterGrid = (bounds: Rect, area?: WaterArea) => editableGrid(bounds, area?.cells)
