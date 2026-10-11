import type { Point, Rect } from './types'
import type { Wall } from './visibility'

/** A point of a wall, by wall and position in its polyline. */
export interface WallPointRef {
  wallId: string
  index: number
}

export const sameRef = (a: WallPointRef, b: WallPointRef) => a.wallId === b.wallId && a.index === b.index

/**
 * Wall points at the same spot (where walls meet, or a closed shape's first and last point)
 * act as one point: selecting, moving or deleting one does all of them.
 */
export const sameSpot = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6

/** Every wall point at position p. */
export function pointsAt(walls: Wall[], p: Point): WallPointRef[] {
  const out: WallPointRef[] = []
  for (const w of walls) {
    w.points.forEach((q, index) => {
      if (sameSpot(p, q)) out.push({ wallId: w.id, index })
    })
  }
  return out
}

/** The refs plus every point sharing a spot with one of them, without duplicates. */
export function withLinked(walls: Wall[], refs: WallPointRef[]): WallPointRef[] {
  const out: WallPointRef[] = []
  for (const ref of refs) {
    const p = walls.find((w) => w.id === ref.wallId)?.points[ref.index]
    for (const linked of p ? pointsAt(walls, p) : [ref]) {
      if (!out.some((r) => sameRef(r, linked))) out.push(linked)
    }
  }
  return out
}

/** Distinct positions of wall points (linked points drawn once). */
export function uniquePositions(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) if (!out.some((q) => sameSpot(p, q))) out.push(p)
  return out
}

/** Move the given wall points by (dx, dy). */
export function moveWallPoints(walls: Wall[], refs: WallPointRef[], dx: number, dy: number): Wall[] {
  if (!refs.length) return walls
  return walls.map((w) => {
    const mine = new Set(refs.filter((r) => r.wallId === w.id).map((r) => r.index))
    if (!mine.size) return w
    return { ...w, points: w.points.map((p, i) => (mine.has(i) ? { x: p.x + dx, y: p.y + dy } : p)) }
  })
}

/**
 * Delete wall points. A wall is cut where a point goes: the segments touching it go too, and
 * what's left on either side becomes its own wall (a single leftover point is no wall).
 * Deleting points in the middle of a wall opens a gap rather than bridging it.
 */
export function deleteWallPoints(walls: Wall[], refs: WallPointRef[], newId: () => string): Wall[] {
  const out: Wall[] = []
  for (const w of walls) {
    const gone = new Set(refs.filter((r) => r.wallId === w.id).map((r) => r.index))
    if (!gone.size) {
      out.push(w)
      continue
    }
    const runs: Point[][] = [[]]
    w.points.forEach((p, i) => {
      if (gone.has(i)) runs.push([])
      else runs[runs.length - 1].push(p)
    })
    // The first piece keeps the wall's id; the others are new walls.
    let first = true
    for (const run of runs) {
      if (run.length < 2) continue
      out.push({ id: first ? w.id : newId(), points: run })
      first = false
    }
  }
  return out
}

/** All wall points inside a rectangle. */
export function wallPointsIn(walls: Wall[], r: Rect): WallPointRef[] {
  const out: WallPointRef[] = []
  for (const w of walls) {
    w.points.forEach((p, index) => {
      if (inRect(p, r)) out.push({ wallId: w.id, index })
    })
  }
  return out
}

export function inRect(p: Point, r: Rect) {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

/** Rectangle spanned by two corners, in any order. */
export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}
