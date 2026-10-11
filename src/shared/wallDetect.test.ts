import { describe, expect, it } from 'vitest'
import {
  detectWalls,
  mapImageOf,
  polygonArea,
  rectify,
  simplifyClosed,
  traceContours,
  type DetectedWall,
  type Pt,
  type RgbImage,
} from './wallDetect'

/**
 * A synthetic dungeon: black void, two textured grey rooms side by side sharing a dark wall
 * line with a one-square doorway, walls drawn as dark lines centred on grid lines.
 * Square size `S` px, rooms in squares x 2..8 and 8..14, y 2..7.
 */
function dungeon(S = 20): RgbImage {
  const width = 18 * S
  const height = 10 * S
  const data = new Float32Array(width * height * 3)
  let seed = 1
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const set = (x: number, y: number, v: number) => data.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inRooms = x >= 2 * S && x < 14 * S && y >= 2 * S && y < 7 * S
      set(x, y, inRooms ? 0.55 + 0.1 * (rand() - 0.5) : 0.03)
    }
  }
  // Dark wall lines, 3px, centred on the grid lines around and between the rooms.
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) set(x, y, 0.12)
  }
  line(2 * S, 2 * S, 14 * S, 2 * S)
  line(2 * S, 7 * S, 14 * S, 7 * S)
  line(2 * S, 2 * S, 2 * S, 7 * S)
  line(14 * S, 2 * S, 14 * S, 7 * S)
  // The shared wall, with a doorway in its fourth square (y 4..5).
  line(8 * S, 2 * S, 8 * S, 4 * S)
  line(8 * S, 5 * S, 8 * S, 7 * S)
  return { width, height, data }
}

const S = 20
const grid = { period: S, phaseX: 0, phaseY: 0 }
/** Points in squares. */
const squares = (w: DetectedWall) => w.points.map((p) => ({ x: p.x / S, y: p.y / S }))

describe('wall detection on a synthetic dungeon', () => {
  const walls = detectWalls(mapImageOf(dungeon(S)), grid)

  it('outlines the rooms along the grid lines', () => {
    const outlines = walls.filter((w) => w.points.length > 3)
    expect(outlines).toHaveLength(1)
    const pts = squares(outlines[0])
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([2, 14, 2, 7])
    // Straight onto the lines: every point is a grid corner.
    for (const p of pts) {
      expect(p.x).toBeCloseTo(Math.round(p.x), 5)
      expect(p.y).toBeCloseTo(Math.round(p.y), 5)
    }
  })

  it('finds the wall between the rooms, and a door in its gap', () => {
    const inner = walls.filter((w) => w.points.length === 2 && !w.door).map(squares)
    expect(inner).toContainEqual([
      { x: 8, y: 2 },
      { x: 8, y: 4 },
    ])
    expect(inner).toContainEqual([
      { x: 8, y: 5 },
      { x: 8, y: 7 },
    ])
    const doors = walls.filter((w) => w.door).map(squares)
    expect(doors).toEqual([
      [
        { x: 8, y: 4 },
        { x: 8, y: 5 },
      ],
    ])
  })
})

describe('contours', () => {
  const mask = (rows: string[]) => {
    const m = new Uint8Array(rows.length * rows[0].length)
    rows.forEach((r, y) => [...r].forEach((c, x) => (m[y * r.length + x] = c === '#' ? 1 : 0)))
    return { m, width: rows[0].length, height: rows.length }
  }

  it('traces each region as a closed outline around its pixels', () => {
    const { m, width, height } = mask(['......', '.##...', '.##..#', '......'])
    const loops = traceContours(m, width, height)
    expect(loops).toHaveLength(2)
    const areas = loops.map((l) => Math.abs(polygonArea(l))).sort((a, b) => a - b)
    // Outlines through pixel-edge midpoints: a 2×2 block encloses 3.5 px², one pixel 0.5.
    expect(areas).toEqual([0.5, 3.5])
  })

  it('simplifies a traced rectangle to its corners', () => {
    const rows = Array.from({ length: 12 }, (_, y) => '.'.repeat(2) + (y > 1 && y < 10 ? '#'.repeat(16) : '.'.repeat(16)) + '..')
    const { m, width, height } = mask(rows)
    const [loop] = traceContours(m, width, height)
    expect(simplifyClosed(loop, 1).length).toBeLessThanOrEqual(8)
  })

  it('straightens an outline onto the grid line that separates floor from void', () => {
    // Floor x < 23 (the wall's outer face), grid lines every 10: the edge belongs on x = 20.
    const width = 60
    const height = 60
    const floor = new Uint8Array(width * height)
    for (let y = 10; y < 50; y++) for (let x = 10; x < 23; x++) floor[y * width + x] = 1
    const poly: Pt[] = [
      { x: 10, y: 10 },
      { x: 23, y: 10 },
      { x: 23, y: 50 },
      { x: 10, y: 50 },
    ]
    const r = rectify(poly, floor, width, height, 10, 0, 0)
    expect(Math.max(...r.map((p) => p.x))).toBe(20)
  })
})
