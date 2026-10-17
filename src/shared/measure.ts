/** Measuring on the map: lines and circles with their distance, and freehand drawing. */
import type { GridSettings, Point } from './types'

export type MeasureShape = 'line' | 'circle' | 'free'
/** Grid traverse: diagonals count 1, like moving. Real: the straight-line distance. */
export type MeasureDistance = 'real' | 'grid'
/** Where lines and circles snap: square centres, or grid corners. */
export type MeasureSnap = 'center' | 'line'

/** A measurement (or drawing) on a floor. Points: a line's ends, a circle's centre and edge, a freehand stroke. */
export interface Measure {
  id: string
  shape: MeasureShape
  points: Point[]
  color: string
  distance: MeasureDistance
}

export const MEASURE_COLORS = [
  { name: 'Red', color: '#e5383b' },
  { name: 'Pink', color: '#ff5ec4' },
  { name: 'Teal', color: '#2ec4b6' },
  { name: 'Yellow', color: '#ffd23f' },
]

/** p snapped to a square's centre or a grid corner. */
export function snapMeasure(p: Point, grid: GridSettings, to: MeasureSnap): Point {
  const s = grid.size
  if (to === 'line') {
    return { x: grid.offsetX + Math.round((p.x - grid.offsetX) / s) * s, y: grid.offsetY + Math.round((p.y - grid.offsetY) / s) * s }
  }
  return {
    x: grid.offsetX + (Math.floor((p.x - grid.offsetX) / s) + 0.5) * s,
    y: grid.offsetY + (Math.floor((p.y - grid.offsetY) / s) + 0.5) * s,
  }
}

/** Squares from a to b. */
export function measureSquares(a: Point, b: Point, grid: number, distance: MeasureDistance): number {
  const dx = Math.abs(b.x - a.x)
  const dy = Math.abs(b.y - a.y)
  return (distance === 'grid' ? Math.max(dx, dy) : Math.hypot(dx, dy)) / grid
}

/**
 * A measurement's label, or null for a drawing: a line's "Movement: 6 yd" (grid traverse) or
 * "Distance: 6.4 yd" (real); a circle's radius, always the real distance.
 */
export function measureLabel(m: Measure, grid: number): string | null {
  if (m.shape === 'free' || m.points.length < 2) return null
  const distance = m.shape === 'circle' ? 'real' : m.distance
  const n = Math.round(measureSquares(m.points[0], m.points[1], grid, distance) * 10) / 10
  if (m.shape === 'circle') return `Radius: ${n} yd`
  return `${distance === 'grid' ? 'Movement' : 'Distance'}: ${n} yd`
}

const toSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Whether p is on the measurement's line, circle or stroke (within `slack`). */
export function hitsMeasure(m: Measure, p: Point, slack: number): boolean {
  const [a, b] = m.points
  if (!a) return false
  if (m.shape === 'circle' && b) {
    const r = Math.hypot(b.x - a.x, b.y - a.y)
    return Math.abs(Math.hypot(p.x - a.x, p.y - a.y) - r) <= slack || toSegment(p, a, b) <= slack
  }
  if (m.points.length === 1) return Math.hypot(p.x - a.x, p.y - a.y) <= slack
  for (let i = 1; i < m.points.length; i++) if (toSegment(p, m.points[i - 1], m.points[i]) <= slack) return true
  return false
}
