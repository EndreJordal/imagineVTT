import type { Rect, Size } from './types'

/**
 * Fog-of-war memory: which parts of the map the party has seen, as a low-resolution grid of
 * 0..255 over the map's bounds. Stored relative to the map, so it stays aligned when the
 * map is moved or scaled.
 */
export interface FogMemory {
  cols: number
  rows: number
  data: Uint8Array
}

/** Cells along the map's longer side. Vision edges are soft, so this is plenty. */
export const FOG_RESOLUTION = 512

/** Something that sees: a scene position and how far it sees (scene units). */
export interface Viewer {
  x: number
  y: number
  range: number
}

export function createFogMemory(bounds: Size): FogMemory {
  const k = FOG_RESOLUTION / Math.max(bounds.width, bounds.height)
  const cols = Math.max(1, Math.round(bounds.width * k))
  const rows = Math.max(1, Math.round(bounds.height * k))
  return { cols, rows, data: new Uint8Array(cols * rows) }
}

/** Whether a memory grid was made for bounds of this shape (not for another map). */
export function fitsBounds(memory: FogMemory, bounds: Size): boolean {
  const k = FOG_RESOLUTION / Math.max(bounds.width, bounds.height)
  return memory.cols === Math.max(1, Math.round(bounds.width * k)) &&
    memory.rows === Math.max(1, Math.round(bounds.height * k))
}

/**
 * How visible a point is at fraction d (0..1) of a viewer's range: fully visible for most of
 * it, easing out over the last stretch so the edge of sight is soft.
 */
export function visionFalloff(d: number): number {
  if (d >= 1) return 0
  if (d <= 0.85) return 1
  const t = (d - 0.85) / 0.15
  return 1 - t * t * (3 - 2 * t)
}

/** Record what the viewers see into memory. Returns whether anything new was seen. */
export function stampVision(memory: FogMemory, bounds: Rect, viewers: Viewer[]): boolean {
  const { cols, rows, data } = memory
  const sx = cols / bounds.width
  const sy = rows / bounds.height
  let changed = false
  for (const v of viewers) {
    const cx = (v.x - bounds.x) * sx
    const cy = (v.y - bounds.y) * sy
    const rx = v.range * sx
    const ry = v.range * sy
    if (rx <= 0 || ry <= 0) continue
    const x0 = Math.max(0, Math.floor(cx - rx))
    const x1 = Math.min(cols - 1, Math.ceil(cx + rx))
    const y0 = Math.max(0, Math.floor(cy - ry))
    const y1 = Math.min(rows - 1, Math.ceil(cy + ry))
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) / ry
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx
        const value = Math.round(255 * visionFalloff(Math.hypot(dx, dy)))
        const i = y * cols + x
        if (value > data[i]) {
          data[i] = value
          changed = true
        }
      }
    }
  }
  return changed
}
