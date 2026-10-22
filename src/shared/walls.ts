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

/**
 * Walls with these points added as corners where they lie on a wall's line (not at its own
 * corners, not on doors), so a new wall ending on another one shares a corner with it and
 * light can't slip through the join.
 */
export function joinOnto(walls: Wall[], points: Point[]): Wall[] {
  let changed = false
  const out = walls.map((w) => {
    if (w.door) return w
    let pts = w.points
    for (const p of points) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        const hit = nearestOnSegment(p, a, b)
        if (hit.distance > 0.01 || hit.t <= 1e-6 || hit.t >= 1 - 1e-6) continue
        pts = [...pts.slice(0, i), { x: p.x, y: p.y }, ...pts.slice(i)]
        break
      }
    }
    if (pts === w.points) return w
    changed = true
    return { ...w, points: pts }
  })
  return changed ? out : walls
}

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

const pathLength = (pts: Point[]) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0)

/**
 * A door between two points that are both corners of one wall, not next to each other: the
 * wall between them is replaced by the door (its corners in between go), and what's left on
 * either side stays. Around a closed shape the shorter way round is the one replaced.
 */
function doorOverStretch(walls: Wall[], a: Point, b: Point, newId: () => string): Wall[] | null {
  for (const w of walls) {
    if (w.door) continue
    const ia = w.points.findIndex((q) => sameSpot(q, a))
    const ib = w.points.findIndex((q) => sameSpot(q, b))
    if (ia < 0 || ib < 0 || ia === ib) continue
    const [i, j] = ia < ib ? [ia, ib] : [ib, ia]
    const P = w.points
    const door: Wall = { id: newId(), points: [{ ...P[i] }, { ...P[j] }], door: { open: false } }
    const closed = P.length >= 4 && sameSpot(P[0], P[P.length - 1])
    let pieces: Point[][]
    if (closed) {
      const direct = pathLength(P.slice(i, j + 1))
      const around = pathLength([...P.slice(j), ...P.slice(1, i + 1)])
      // Keep the longer way round as the wall, a single open piece from one door end to the other.
      pieces = [direct <= around ? [...P.slice(j), ...P.slice(1, i + 1)] : P.slice(i, j + 1)]
    } else {
      pieces = [P.slice(0, i + 1), P.slice(j)]
    }
    const out: Wall[] = []
    for (const x of walls) {
      if (x.id !== w.id) {
        out.push(x)
        continue
      }
      let first = true
      for (const piece of pieces) {
        if (piece.length < 2) continue
        out.push({ id: first ? w.id : newId(), points: piece.map((pt) => ({ ...pt })) })
        first = false
      }
      out.push(door)
    }
    return out
  }
  return null
}

/** Whether p is one of the walls' points (doors aside). */
const isWallPoint = (walls: Wall[], p: Point) => walls.some((w) => !w.door && w.points.some((q) => sameSpot(q, p)))

/**
 * Put a door between a and b, two points on the same stretch of wall: the wall is cut
 * there (the pieces on either side stay walls) and a closed door spans the gap. A door
 * ending on a wall point shares it. Two corners of one wall with others between them get a
 * door in place of that stretch of wall. Two wall points with no wall between them (the
 * ends of two walls, a gap left for a doorway) get a door across the gap. Returns null if
 * none applies.
 */
export function makeDoor(walls: Wall[], a: Point, b: Point, newId: () => string): Wall[] | null {
  if (sameSpot(a, b)) return null
  const at = commonSegment(walls, a, b)
  if (!at) {
    // Two corners of one wall (with others between them): the door replaces what's between.
    const over = doorOverStretch(walls, a, b, newId)
    if (over) return over
    // Otherwise only the ends of different walls, with nothing between them: a door in the gap.
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
