import type { Point } from './types'
import type { DoorReveal } from './doors'
import type { DoorSounds } from './sound'

/** A wall segment between two points (scene units). */
export interface Segment {
  a: Point
  b: Point
}

/** A wall: a polyline of points; each consecutive pair is a segment that blocks sight. */
export interface Wall {
  id: string
  points: Point[]
  /**
   * A door: a two-point wall that can be opened. Closed doors block sight like walls; open
   * ones don't. Being walls, doors get linked points, selection, dragging etc. for free.
   */
  door?: {
    open: boolean
    /** How what it hid comes into view when it's opened; absent: the scene's (all doors). */
    reveal?: DoorReveal
    /** Its own open and close sounds; absent: the scene's (all doors). */
    sounds?: DoorSounds
  }
}

/** Segments that block sight: walls, and doors that are closed. */
export function wallSegments(walls: Wall[]): Segment[] {
  const out: Segment[] = []
  for (const w of walls) {
    if (w.door?.open) continue
    for (let i = 1; i < w.points.length; i++) out.push({ a: w.points[i - 1], b: w.points[i] })
  }
  return out
}

/**
 * Whether moving in a straight line from `from` to `to` crosses a blocking segment. Touching
 * one counts (ending on a wall, or slipping through where two walls meet), but starting on
 * one doesn't, so a token that was placed on a wall can still step off it.
 */
export function moveCrossesWall(from: Point, to: Point, segments: Segment[]): boolean {
  if (from.x === to.x && from.y === to.y) return false
  for (const s of segments) {
    const eps = 1e-9 * Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)
    const start = side(s.a, s.b, from)
    if (Math.abs(start) <= eps) continue
    const end = side(s.a, s.b, to)
    if (Math.abs(end) > eps && Math.sign(end) === Math.sign(start)) continue // stays on its side
    // It crosses the wall's line; does it cross between the wall's ends?
    if (side(from, to, s.a) * side(from, to, s.b) > 0) continue
    return true
  }
  return false
}

/** Which side of line a→b point p is on (sign), times the line's length. */
function side(a: Point, b: Point, p: Point) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
}

/**
 * The area visible from `origin` within `range`, given blocking segments: a polygon around
 * the origin, its vertices in angle order. Classic ray casting: a ray towards every wall
 * endpoint (and just either side of it, to slip past corners), stopped by the nearest wall
 * or the range's bounding square. Callers clip it to the round range themselves.
 */
export function visibilityPolygon(origin: Point, range: number, segments: Segment[]): Point[] {
  const box = squareAround(origin, range)
  const relevant = segments.filter((s) => segmentNearBox(s, origin, range))
  const blockers = [...relevant, ...box]

  const angles: number[] = []
  for (const s of blockers) {
    for (const p of [s.a, s.b]) {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x)
      angles.push(a - 1e-5, a, a + 1e-5)
    }
  }
  angles.sort((x, y) => x - y)

  const polygon: Point[] = []
  let lastAngle = NaN
  for (const angle of angles) {
    if (angle === lastAngle) continue
    lastAngle = angle
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    let nearest = Infinity
    for (const s of blockers) {
      const t = rayHit(origin, dx, dy, s)
      if (t < nearest) nearest = t
    }
    if (nearest < Infinity) polygon.push({ x: origin.x + dx * nearest, y: origin.y + dy * nearest })
  }
  return polygon
}

/** Distance along the ray (origin + t·(dx,dy), t ≥ 0) to segment s, or Infinity. */
function rayHit(o: Point, dx: number, dy: number, s: Segment): number {
  const ex = s.b.x - s.a.x
  const ey = s.b.y - s.a.y
  const denom = dx * ey - dy * ex
  if (Math.abs(denom) < 1e-12) return Infinity // parallel
  const ax = s.a.x - o.x
  const ay = s.a.y - o.y
  const t = (ax * ey - ay * ex) / denom // along the ray
  const u = (ax * dy - ay * dx) / denom // along the segment
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity
}

function squareAround(c: Point, r: number): Segment[] {
  const tl = { x: c.x - r, y: c.y - r }
  const tr = { x: c.x + r, y: c.y - r }
  const br = { x: c.x + r, y: c.y + r }
  const bl = { x: c.x - r, y: c.y + r }
  return [
    { a: tl, b: tr },
    { a: tr, b: br },
    { a: br, b: bl },
    { a: bl, b: tl },
  ]
}

/** Cheap reject: segments whose bounding box misses the range square can't block. */
function segmentNearBox(s: Segment, c: Point, r: number) {
  return (
    Math.max(s.a.x, s.b.x) >= c.x - r &&
    Math.min(s.a.x, s.b.x) <= c.x + r &&
    Math.max(s.a.y, s.b.y) >= c.y - r &&
    Math.min(s.a.y, s.b.y) <= c.y + r
  )
}

/**
 * Whether p is inside a visibility polygon from `origin` (star-shaped around it): find the
 * polygon edge spanning p's direction by angle, and compare distances. O(log n).
 */
export function createVisibilityTest(origin: Point, polygon: Point[]): (p: Point) => boolean {
  const n = polygon.length
  if (n < 3) return () => false
  const angles = polygon.map((v) => Math.atan2(v.y - origin.y, v.x - origin.x))
  return (p) => {
    const dx = p.x - origin.x
    const dy = p.y - origin.y
    if (dx === 0 && dy === 0) return true
    const angle = Math.atan2(dy, dx)
    // First vertex with angle >= p's; the edge from the one before spans p's direction.
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (angles[mid] < angle) lo = mid + 1
      else hi = mid
    }
    const a = polygon[(lo - 1 + n) % n]
    const b = polygon[lo % n]
    // p is visible if it's on the origin's side of edge a→b.
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const originCross = (b.x - a.x) * (origin.y - a.y) - (b.y - a.y) * (origin.x - a.x)
    return cross === 0 || Math.sign(cross) === Math.sign(originCross)
  }
}
