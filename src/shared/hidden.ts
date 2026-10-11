import { createFogMemory } from './fog'
import type { Point, Rect } from './types'
import type { Wall } from './visibility'

/**
 * Hidden areas: parts of a floor the GM blacks out on the table (a building's inside, a
 * secret room) whatever the party can see, without blocking their sight past them. A mask
 * over the map's bounds, on the same grid as fog memory, so it stays with the map when the
 * map is moved or scaled.
 *
 * Kept in the scene (it's undone, saved and sent to the table with it) run-length encoded:
 * `runs` alternates lengths of shown and hidden cells, starting with shown.
 */
export interface HiddenAreas {
  cols: number
  rows: number
  runs: number[]
}

/** Edge softness (in squares) when the scene doesn't say. */
export const DEFAULT_HIDDEN_SOFTNESS = 0.3

/** A mask (1 hidden, 0 shown) as HiddenAreas; null when nothing is hidden. */
export function encodeHidden(cols: number, rows: number, mask: Uint8Array): HiddenAreas | null {
  const runs: number[] = []
  let value = 0
  let length = 0
  let any = false
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 1 : 0
    if (v === value) {
      length++
      continue
    }
    runs.push(length)
    value = v
    length = 1
    any = true
  }
  runs.push(length)
  return any ? { cols, rows, runs } : null
}

const decoded = new WeakMap<HiddenAreas, Uint8Array>()

/** The mask of hidden cells (1 hidden). Shared: copy it before changing it. */
export function decodeHidden(hidden: HiddenAreas): Uint8Array {
  let mask = decoded.get(hidden)
  if (!mask) {
    mask = new Uint8Array(hidden.cols * hidden.rows)
    let i = 0
    hidden.runs.forEach((length, k) => {
      if (k % 2) mask!.fill(1, i, i + length)
      i += length
    })
    decoded.set(hidden, mask)
  }
  return mask
}

/** The grid hidden areas use over these bounds (the fog memory's). */
export function hiddenGrid(bounds: Rect): { cols: number; rows: number } {
  const { cols, rows } = createFogMemory(bounds)
  return { cols, rows }
}

/**
 * The mask for `bounds` (a fresh copy, to change): the scene's, or all shown if there's none
 * or it was made for a map of another shape.
 */
export function editableMask(hidden: HiddenAreas | null | undefined, bounds: Rect) {
  const { cols, rows } = hiddenGrid(bounds)
  const mask = new Uint8Array(cols * rows)
  if (hidden && hidden.cols === cols && hidden.rows === rows) mask.set(decodeHidden(hidden))
  return { cols, rows, mask }
}

/** The mask to draw or test against, if it fits these bounds (not a copy). */
export function hiddenMask(hidden: HiddenAreas | null | undefined, bounds: Rect): Uint8Array | null {
  if (!hidden) return null
  const { cols, rows } = hiddenGrid(bounds)
  return hidden.cols === cols && hidden.rows === rows ? decodeHidden(hidden) : null
}

interface Grid {
  cols: number
  rows: number
  mask: Uint8Array
}

/** Cell coordinates (fractional) of a scene point. */
function toCell(g: Grid, bounds: Rect, p: Point): Point {
  return { x: ((p.x - bounds.x) / bounds.width) * g.cols, y: ((p.y - bounds.y) / bounds.height) * g.rows }
}

/**
 * Paint (value 1) or erase (0) a brush stroke from `from` to `to`: every cell within
 * `radius` (scene units) of the line. Returns whether anything changed.
 */
export function paintHidden(g: Grid, bounds: Rect, from: Point, to: Point, radius: number, value: 0 | 1): boolean {
  const a = toCell(g, bounds, from)
  const b = toCell(g, bounds, to)
  const r = (radius / bounds.width) * g.cols
  const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r))
  const x1 = Math.min(g.cols - 1, Math.ceil(Math.max(a.x, b.x) + r))
  const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r))
  const y1 = Math.min(g.rows - 1, Math.ceil(Math.max(a.y, b.y) + r))
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let changed = false
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0
      const d = Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
      const i = y * g.cols + x
      if (d <= r && g.mask[i] !== value) {
        g.mask[i] = value
        changed = true
      }
    }
  }
  return changed
}

/**
 * Walls and doors (open or closed: a doorway is still part of the room's outline) drawn
 * into the grid as barrier cells, thick enough that nothing leaks through diagonally.
 */
function barriers(g: Grid, bounds: Rect, walls: Wall[]): Uint8Array {
  const out = new Uint8Array(g.cols * g.rows)
  const mark = (x: number, y: number) => {
    for (let yy = Math.floor(y - 0.75); yy <= Math.floor(y + 0.75); yy++) {
      for (let xx = Math.floor(x - 0.75); xx <= Math.floor(x + 0.75); xx++) {
        if (xx >= 0 && yy >= 0 && xx < g.cols && yy < g.rows) out[yy * g.cols + xx] = 1
      }
    }
  }
  for (const w of walls) {
    for (let i = 1; i < w.points.length; i++) {
      const a = toCell(g, bounds, w.points[i - 1])
      const b = toCell(g, bounds, w.points[i])
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2))
      for (let s = 0; s <= steps; s++) mark(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps)
    }
  }
  return out
}

/** Cells reachable from `start` (4-connected) through cells where `open(i)` holds. */
function flood(g: Grid, start: number, open: (i: number) => boolean): { cells: Int32Array; count: number; edge: boolean } {
  const seen = new Uint8Array(g.cols * g.rows)
  const cells = new Int32Array(g.cols * g.rows)
  let count = 0
  let edge = false
  cells[count++] = start
  seen[start] = 1
  for (let k = 0; k < count; k++) {
    const i = cells[k]
    const x = i % g.cols
    const y = (i - x) / g.cols
    if (x === 0 || y === 0 || x === g.cols - 1 || y === g.rows - 1) edge = true
    const next = [x > 0 ? i - 1 : -1, x < g.cols - 1 ? i + 1 : -1, y > 0 ? i - g.cols : -1, y < g.rows - 1 ? i + g.cols : -1]
    for (const j of next) {
      if (j >= 0 && !seen[j] && open(j)) {
        seen[j] = 1
        cells[count++] = j
      }
    }
  }
  return { cells, count, edge }
}

export type FillResult = 'filled' | 'revealed' | 'open' | 'on-wall'

/**
 * Dropper: click inside a space enclosed by walls and doors to hide all of it (up to the
 * wall lines). Clicking somewhere already hidden reveals that hidden patch instead.
 * A space that isn't enclosed (the fill would reach the map's edge) is left alone: 'open'.
 */
export function fillHidden(g: Grid, bounds: Rect, walls: Wall[], at: Point): FillResult {
  const c = toCell(g, bounds, at)
  const x = Math.floor(c.x)
  const y = Math.floor(c.y)
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return 'open'
  const start = y * g.cols + x
  if (g.mask[start]) {
    const patch = flood(g, start, (i) => g.mask[i] === 1)
    for (let k = 0; k < patch.count; k++) g.mask[patch.cells[k]] = 0
    return 'revealed'
  }
  const wall = barriers(g, bounds, walls)
  if (wall[start]) return 'on-wall'
  const room = flood(g, start, (i) => !wall[i])
  if (room.edge) return 'open'
  for (let k = 0; k < room.count; k++) g.mask[room.cells[k]] = 1
  // Out to the wall lines: the barrier cells bordering the room.
  for (let k = 0; k < room.count; k++) {
    const i = room.cells[k]
    const cx = i % g.cols
    for (const j of [cx > 0 ? i - 1 : -1, cx < g.cols - 1 ? i + 1 : -1, i - g.cols, i + g.cols]) {
      if (j >= 0 && j < wall.length && wall[j]) g.mask[j] = 1
    }
  }
  return 'filled'
}

/** The mask turned `turns` quarter turns clockwise (with the map it covers). */
export function turnHidden(hidden: HiddenAreas, turns: number): HiddenAreas | null {
  let cols = hidden.cols
  let rows = hidden.rows
  let mask = decodeHidden(hidden)
  for (let t = 0; t < (((turns % 4) + 4) % 4); t++) {
    const out = new Uint8Array(mask.length)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) out[x * rows + (rows - 1 - y)] = mask[y * cols + x]
    }
    mask = out
    ;[cols, rows] = [rows, cols]
  }
  return encodeHidden(cols, rows, mask)
}

/**
 * The mask with soft edges, 0..255, for drawing: blurred over `radius` cells (three box
 * blurs, close to a Gaussian). Hidden cells stay fully hidden up to the edge's middle.
 */
export function softenHidden(mask: Uint8Array, cols: number, rows: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 255 : 0
  const r = Math.round(radius / Math.sqrt(3))
  if (r < 1) return out
  const line = new Float32Array(Math.max(cols, rows))
  const blur = (count: number, length: number, at: (k: number, i: number) => number) => {
    for (let k = 0; k < count; k++) {
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < length; i++) line[i] = out[at(k, i)]
        let sum = 0
        for (let i = -r; i <= r; i++) sum += line[Math.min(length - 1, Math.max(0, i))]
        for (let i = 0; i < length; i++) {
          out[at(k, i)] = Math.round(sum / (2 * r + 1))
          sum += line[Math.min(length - 1, i + r + 1)] - line[Math.max(0, i - r)]
        }
      }
    }
  }
  blur(rows, cols, (y, x) => y * cols + x)
  blur(cols, rows, (x, y) => y * cols + x)
  return out
}
