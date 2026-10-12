import { fogGrid } from './fog'
import type { Point, Rect } from './types'
import type { Wall } from './visibility'

/**
 * Hidden areas: parts of a floor the GM blacks out on the table (a building's inside, a
 * secret room) whatever the party can see, without blocking their sight past them. Each is
 * a mask over the map's bounds, on the same grid as fog memory, so it stays with the map
 * when the map is moved or scaled; each has its own soft edges, and may reveal itself when
 * a vision token walks in.
 *
 * Kept in the scene (undone, saved and sent to the table with it), masks run-length
 * encoded: `runs` alternates lengths of shown and hidden cells, starting with shown.
 */
export interface HiddenMask {
  cols: number
  rows: number
  runs: number[]
}

export interface HiddenArea {
  id: string
  cells: HiddenMask
  /** How far its edges fade out, in squares (outwards: all of it stays hidden). */
  softness: number
  /** Revealed when a vision token walks into it. */
  revealWithVision: boolean
}

/** Edge softness (in squares) for new areas. */
export const DEFAULT_HIDDEN_SOFTNESS = 0.3

/** A mask (1 hidden, 0 shown), encoded; null when nothing is hidden. */
export function encodeHidden(cols: number, rows: number, mask: Uint8Array): HiddenMask | null {
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

const decoded = new WeakMap<HiddenMask, Uint8Array>()

/** The mask of hidden cells (1 hidden). Shared: copy it before changing it. */
export function decodeHidden(hidden: HiddenMask): Uint8Array {
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
  return fogGrid(bounds)
}

/** A mask being worked on, on the hidden grid. */
export interface Grid {
  cols: number
  rows: number
  mask: Uint8Array
}

/** Whether a mask was made for bounds of this shape (not for another map). */
function fits(cells: HiddenMask, bounds: Rect) {
  const { cols, rows } = hiddenGrid(bounds)
  return cells.cols === cols && cells.rows === rows
}

/** A grid to draw into: an area's cells (a fresh copy), or nothing hidden. */
export function editableGrid(bounds: Rect, cells?: HiddenMask | null): Grid {
  const { cols, rows } = hiddenGrid(bounds)
  const mask = new Uint8Array(cols * rows)
  if (cells && fits(cells, bounds)) mask.set(decodeHidden(cells))
  return { cols, rows, mask }
}

/** An area's mask for these bounds (not a copy), if it was made for them. */
export function areaMask(area: HiddenArea, bounds: Rect): Uint8Array | null {
  return fits(area.cells, bounds) ? decodeHidden(area.cells) : null
}

const unions = new WeakMap<HiddenArea[], { cols: number; rows: number; mask: Uint8Array | null }>()

/** Everything hidden on the floor (to test against, not a copy); null if nothing is. */
export function unionMask(areas: HiddenArea[] | undefined, bounds: Rect): Uint8Array | null {
  if (!areas?.length) return null
  const { cols, rows } = hiddenGrid(bounds)
  const cached = unions.get(areas)
  if (cached && cached.cols === cols && cached.rows === rows) return cached.mask
  let mask: Uint8Array | null = null
  for (const a of areas) {
    const m = areaMask(a, bounds)
    if (!m) continue
    mask ??= new Uint8Array(cols * rows)
    for (let i = 0; i < m.length; i++) if (m[i]) mask[i] = 1
  }
  unions.set(areas, { cols, rows, mask })
  return mask
}

/** Whether a scene point is in an area. */
export function inArea(area: HiddenArea, bounds: Rect, p: Point): boolean {
  const mask = areaMask(area, bounds)
  if (!mask) return false
  const { cols, rows } = area.cells
  const i = cellAt({ cols, rows, mask }, bounds, p)
  return i >= 0 && mask[i] === 1
}

/** The area at a scene point (the topmost, last drawn), if any. */
export function areaAt(areas: HiddenArea[] | undefined, bounds: Rect, p: Point): HiddenArea | undefined {
  return [...(areas ?? [])].reverse().find((a) => inArea(a, bounds, p))
}

/** An area's middle and extent, as fractions of the grid (computed once per mask). */
const shapes = new WeakMap<HiddenMask, { cx: number; cy: number; x0: number; y0: number; x1: number; y1: number }>()

function shapeOf(cells: HiddenMask) {
  let shape = shapes.get(cells)
  if (!shape) {
    const { cols, rows } = cells
    const mask = decodeHidden(cells)
    let sx = 0
    let sy = 0
    let n = 0
    let x0 = cols
    let y0 = rows
    let x1 = 0
    let y1 = 0
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue
      const x = i % cols
      const y = (i - x) / cols
      sx += x + 0.5
      sy += y + 0.5
      n++
      if (x < x0) x0 = x
      if (x + 1 > x1) x1 = x + 1
      if (y < y0) y0 = y
      y1 = y + 1
    }
    shape = n
      ? { cx: sx / n / cols, cy: sy / n / rows, x0: x0 / cols, y0: y0 / rows, x1: x1 / cols, y1: y1 / rows }
      : { cx: 0.5, cy: 0.5, x0: 0, y0: 0, x1: 0, y1: 0 }
    shapes.set(cells, shape)
  }
  return shape
}

/** Where an area's token sits: the middle of its cells, in scene coordinates. */
export function areaCentre(area: HiddenArea, bounds: Rect): Point {
  const { cx, cy } = shapeOf(area.cells)
  return { x: bounds.x + cx * bounds.width, y: bounds.y + cy * bounds.height }
}

/** The scene rect an area covers. */
export function areaRect(area: HiddenArea, bounds: Rect): Rect {
  const { x0, y0, x1, y1 } = shapeOf(area.cells)
  return {
    x: bounds.x + x0 * bounds.width,
    y: bounds.y + y0 * bounds.height,
    width: (x1 - x0) * bounds.width,
    height: (y1 - y0) * bounds.height,
  }
}

/**
 * Areas from a scene saved when hidden areas were one mask (with one softness): each
 * separate patch becomes an area of its own.
 */
export function legacyAreas(hidden: HiddenMask | null | undefined, softness?: number): HiddenArea[] {
  if (!hidden?.runs) return []
  return splitHidden(hidden).map((cells, i) => ({
    id: `hidden-${i}-${hidden.runs.length}`,
    cells,
    softness: softness ?? DEFAULT_HIDDEN_SOFTNESS,
    revealWithVision: true,
  }))
}

/** The separate patches of a mask (8-connected), each as its own mask: old scenes' areas. */
function splitHidden(cells: HiddenMask): HiddenMask[] {
  const { cols, rows } = cells
  const mask = decodeHidden(cells)
  const g = { cols, rows, mask }
  const taken = new Uint8Array(mask.length)
  const out: HiddenMask[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || taken[start]) continue
    const patch = flood(g, start, (i) => mask[i] === 1 && !taken[i], true)
    const part = new Uint8Array(mask.length)
    for (let k = 0; k < patch.count; k++) {
      taken[patch.cells[k]] = 1
      part[patch.cells[k]] = 1
    }
    const encoded = encodeHidden(cols, rows, part)
    if (encoded) out.push(encoded)
  }
  return out
}

/** Cell coordinates (fractional) of a scene point. *//** Cell coordinates (fractional) of a scene point. */
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

/** Cells reachable from `start` (4-connected, or 8) through cells where `open(i)` holds. */
function flood(
  g: Grid,
  start: number,
  open: (i: number) => boolean,
  diagonals = false,
): { cells: Int32Array; count: number; edge: boolean } {
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
    const left = x > 0
    const right = x < g.cols - 1
    const up = y > 0
    const down = y < g.rows - 1
    const next = [left ? i - 1 : -1, right ? i + 1 : -1, up ? i - g.cols : -1, down ? i + g.cols : -1]
    if (diagonals) {
      next.push(left && up ? i - g.cols - 1 : -1, right && up ? i - g.cols + 1 : -1)
      next.push(left && down ? i + g.cols - 1 : -1, right && down ? i + g.cols + 1 : -1)
    }
    for (const j of next) {
      if (j >= 0 && !seen[j] && open(j)) {
        seen[j] = 1
        cells[count++] = j
      }
    }
  }
  return { cells, count, edge }
}

export type FillResult = 'filled' | 'open' | 'on-wall'

/** The grid cell index of a scene point, or -1 outside the grid. */
function cellAt(g: Grid, bounds: Rect, p: Point): number {
  const c = toCell(g, bounds, p)
  const x = Math.floor(c.x)
  const y = Math.floor(c.y)
  return x < 0 || y < 0 || x >= g.cols || y >= g.rows ? -1 : y * g.cols + x
}

/**
 * Dropper: the space enclosed by walls and doors around `at`, drawn into `g` (up to the
 * wall lines). A space that isn't enclosed (it would reach the map's edge) is left alone:
 * 'open'.
 */
export function fillHidden(g: Grid, bounds: Rect, walls: Wall[], at: Point): FillResult {
  const start = cellAt(g, bounds, at)
  if (start < 0) return 'open'
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

/**
 * The mask grown by `distance` cells (about round: chamfer distances, 1 straight and 1.4
 * diagonally, from the nearest hidden cell). In place.
 */
function grow(mask: Uint8Array, cols: number, rows: number, distance: number): void {
  const D = Math.SQRT2
  const d = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) d[i] = mask[i] ? 0 : distance + 2
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      let v = d[i]
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1
      if (y > 0) {
        const up = i - cols
        if (d[up] + 1 < v) v = d[up] + 1
        if (x > 0 && d[up - 1] + D < v) v = d[up - 1] + D
        if (x < cols - 1 && d[up + 1] + D < v) v = d[up + 1] + D
      }
      d[i] = v
    }
  }
  for (let y = rows - 1; y >= 0; y--) {
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x
      let v = d[i]
      if (x < cols - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1
      if (y < rows - 1) {
        const down = i + cols
        if (d[down] + 1 < v) v = d[down] + 1
        if (x < cols - 1 && d[down + 1] + D < v) v = d[down + 1] + D
        if (x > 0 && d[down - 1] + D < v) v = d[down - 1] + D
      }
      d[i] = v
    }
  }
  for (let i = 0; i < mask.length; i++) mask[i] = d[i] <= distance ? 1 : 0
}

/** The mask turned `turns` quarter turns clockwise (with the map it covers). */
export function turnHidden(hidden: HiddenMask, turns: number): HiddenMask | null {
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

/** Part of the hidden grid: `pixels` (width × height) placed at cell (x, y). */
export interface SoftRegion {
  x: number
  y: number
  width: number
  height: number
  pixels: Uint8Array
}

/**
 * The mask with soft edges, 0..255, for drawing: fading out over about `radius` cells
 * *outside* what's hidden, so everything hidden stays fully black. The mask is grown by the
 * blur's reach first, then blurred (three box blurs, close to a Gaussian). Only the part
 * around what's hidden is worked on and returned; null if nothing is hidden.
 */
export function softenHidden(mask: Uint8Array, cols: number, rows: number, radius: number): SoftRegion | null {
  let x0 = cols
  let y0 = rows
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < rows; y++) {
    const row = y * cols
    for (let x = 0; x < cols; x++) {
      if (!mask[row + x]) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      y1 = y
    }
  }
  if (x1 < 0) return null
  // Three box blurs of half-width r reach 3r each way (3r·√2 diagonally): grown that far,
  // hidden cells stay fully hidden, and the fade (about 6r wide) lies outside them.
  const r = radius < 1 ? 0 : Math.max(1, Math.round(radius / 6))
  const growth = Math.ceil(3 * r * Math.SQRT2)
  const margin = r ? growth + 3 * r + 1 : 0
  const x = Math.max(0, x0 - margin)
  const y = Math.max(0, y0 - margin)
  const width = Math.min(cols, x1 + margin + 1) - x
  const height = Math.min(rows, y1 + margin + 1) - y
  const local = new Uint8Array(width * height)
  for (let j = 0; j < height; j++) local.set(mask.subarray((y + j) * cols + x, (y + j) * cols + x + width), j * width)
  if (r) grow(local, width, height, growth)
  const pixels = new Uint8Array(local.length)
  for (let i = 0; i < local.length; i++) pixels[i] = local[i] ? 255 : 0
  if (r) {
    const line = new Float32Array(Math.max(width, height))
    const blurLine = (length: number, stride: number, start: number) => {
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < length; i++) line[i] = pixels[start + i * stride]
        let sum = 0
        for (let i = -r; i <= r; i++) sum += line[Math.min(length - 1, Math.max(0, i))]
        for (let i = 0; i < length; i++) {
          pixels[start + i * stride] = Math.round(sum / (2 * r + 1))
          sum += line[Math.min(length - 1, i + r + 1)] - line[Math.max(0, i - r)]
        }
      }
    }
    for (let j = 0; j < height; j++) blurLine(width, 1, j * width)
    for (let i = 0; i < width; i++) blurLine(height, width, i)
  }
  return { x, y, width, height, pixels }
}
