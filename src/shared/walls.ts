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
  const seen = new Set<string>()
  return points.filter((p) => {
    const key = spotKey(p)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A key that's the same for points at the same spot (as sameSpot judges them, near enough). */
export const spotKey = (p: Point) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`

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

/** Distance from p to segment a–b, and how far along it (0..1) the nearest point is. */
export function nearestOnSegment(p: Point, a: Point, b: Point): { point: Point; distance: number; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  const point = { x: a.x + t * dx, y: a.y + t * dy }
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y), t }
}

/** How close (scene units) a point must be to a wall line to count as on it. */
const ON_LINE = 1e-3

/** The wall segment (non-door wall, index i: points i → i+1) that both points lie on. */
function commonSegment(walls: Wall[], a: Point, b: Point): { wallId: string; index: number } | null {
  for (const w of walls) {
    if (w.door) continue
    for (let i = 0; i + 1 < w.points.length; i++) {
      const p = w.points[i]
      const q = w.points[i + 1]
      if (nearestOnSegment(a, p, q).distance < ON_LINE && nearestOnSegment(b, p, q).distance < ON_LINE) {
        return { wallId: w.id, index: i }
      }
    }
  }
  return null
}

/** Whether p is one of the walls' points (doors aside). */
const isWallPoint = (walls: Wall[], p: Point) => walls.some((w) => !w.door && w.points.some((q) => sameSpot(q, p)))

/**
 * Put a door between a and b, two points on the same stretch of wall: the wall is cut
 * there (the pieces on either side stay walls) and a closed door spans the gap. A door
 * ending on a wall point shares it. Two wall points with no wall between them (the ends
 * of two walls, a gap left for a doorway) get a door across the gap. Returns null if
 * neither applies.
 */
export function makeDoor(walls: Wall[], a: Point, b: Point, newId: () => string): Wall[] | null {
  if (sameSpot(a, b)) return null
  const at = commonSegment(walls, a, b)
  if (!at) {
    if (!isWallPoint(walls, a) || !isWallPoint(walls, b)) return null
    return [...walls, { id: newId(), points: [{ ...a }, { ...b }], door: { open: false } }]
  }
  const out: Wall[] = []
  for (const w of walls) {
    if (w.id !== at.wallId) {
      out.push(w)
      continue
    }
    const p = w.points[at.index]
    const q = w.points[at.index + 1]
    // Order the door's ends along the segment: `near` is the one closer to p.
    const [near, far] =
      nearestOnSegment(a, p, q).t <= nearestOnSegment(b, p, q).t ? [a, b] : [b, a]
    const before = [...w.points.slice(0, at.index + 1), { ...near }]
    const after = [{ ...far }, ...w.points.slice(at.index + 1)]
    // Drop the zero-length bit where the door ends exactly on a wall point.
    const trim = (pts: Point[]) => pts.filter((pt, i) => i === 0 || !sameSpot(pt, pts[i - 1]))
    let first = true
    for (const piece of [trim(before), trim(after)]) {
      if (piece.length < 2) continue
      out.push({ id: first ? w.id : newId(), points: piece })
      first = false
    }
    out.push({ id: newId(), points: [{ ...near }, { ...far }], door: { open: false } })
  }
  return out
}

/**
 * If the selection is exactly two neighbouring points of one wall (linked copies aside),
 * which wall and segment they span: a candidate for "convert to door".
 */
export function selectedSegment(walls: Wall[], refs: WallPointRef[]): { a: Point; b: Point } | null {
  const positions = uniquePositions(
    refs
      .map((r) => walls.find((w) => w.id === r.wallId)?.points[r.index])
      .filter((p): p is Point => !!p),
  )
  if (positions.length !== 2) return null
  const [a, b] = positions
  for (const w of walls) {
    if (w.door) continue
    for (let i = 0; i + 1 < w.points.length; i++) {
      const p = w.points[i]
      const q = w.points[i + 1]
      if ((sameSpot(p, a) && sameSpot(q, b)) || (sameSpot(p, b) && sameSpot(q, a))) return { a, b }
    }
  }
  return null
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
