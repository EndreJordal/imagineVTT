import { describe, expect, it } from 'vitest'
import {
  areaAt,
  areaCentre,
  decodeHidden,
  editableGrid,
  encodeHidden,
  fillHidden,
  legacyAreas,
  paintHidden,
  softenHidden,
  turnHidden,
  unionMask,
  type HiddenArea,
} from './hidden'
import type { Wall } from './visibility'

const bounds = { x: 0, y: 0, width: 1000, height: 1000 }
/** A closed 200 x 200 room at (400, 400). */
const room: Wall[] = [
  {
    id: 'room',
    points: [
      { x: 400, y: 400 },
      { x: 600, y: 400 },
      { x: 600, y: 600 },
      { x: 400, y: 600 },
      { x: 400, y: 400 },
    ],
  },
]
const hiddenAt = (g: ReturnType<typeof editableGrid>, x: number, y: number) =>
  g.mask[Math.floor((y / 1000) * g.rows) * g.cols + Math.floor((x / 1000) * g.cols)]

describe('hidden areas encoding', () => {
  it('round-trips a mask, and is null when nothing is hidden', () => {
    const mask = new Uint8Array([0, 0, 1, 1, 1, 0, 1, 0, 0])
    const h = encodeHidden(3, 3, mask)!
    expect(h.runs).toEqual([2, 3, 1, 1, 2])
    expect(decodeHidden(h)).toEqual(mask)
    expect(encodeHidden(3, 3, new Uint8Array(9))).toBeNull()
    expect(decodeHidden(encodeHidden(2, 1, new Uint8Array([1, 1]))!)).toEqual(new Uint8Array([1, 1]))
  })
})

describe('the dropper', () => {
  it('hides an enclosed room, up to its walls, and nothing outside', () => {
    const g = editableGrid(bounds)
    expect(fillHidden(g, bounds, room, { x: 500, y: 500 })).toBe('filled')
    expect(hiddenAt(g, 500, 500)).toBe(1)
    expect(hiddenAt(g, 405, 500)).toBe(1)
    expect(hiddenAt(g, 300, 500)).toBe(0)
    expect(hiddenAt(g, 700, 700)).toBe(0)
  })

  it("refuses a space that isn't enclosed", () => {
    const open: Wall[] = [{ id: 'w', points: room[0].points.slice(0, 4) }] // three sides
    const g = editableGrid(bounds)
    expect(fillHidden(g, bounds, open, { x: 500, y: 500 })).toBe('open')
    expect(g.mask.every((v: number) => v === 0)).toBe(true)
  })

  it('counts doors as part of the outline, open or not', () => {
    const walls: Wall[] = [
      { id: 'w', points: room[0].points.slice(0, 4) },
      { id: 'd', points: [room[0].points[3], room[0].points[4]], door: { open: true } },
    ]
    const g = editableGrid(bounds)
    expect(fillHidden(g, bounds, walls, { x: 500, y: 500 })).toBe('filled')
  })

  it('refuses a click on the wall itself', () => {
    const g = editableGrid(bounds)
    expect(fillHidden(g, bounds, room, { x: 400, y: 500 })).toBe('on-wall')
  })
})

describe('the brush', () => {
  it('paints and erases along a stroke', () => {
    const g = editableGrid(bounds)
    expect(paintHidden(g, bounds, { x: 100, y: 100 }, { x: 300, y: 100 }, 20, 1)).toBe(true)
    expect(hiddenAt(g, 200, 100)).toBe(1)
    expect(hiddenAt(g, 200, 150)).toBe(0)
    paintHidden(g, bounds, { x: 200, y: 100 }, { x: 200, y: 100 }, 30, 0)
    expect(hiddenAt(g, 200, 100)).toBe(0)
    expect(hiddenAt(g, 120, 100)).toBe(1)
  })
})

describe('turning and softening', () => {
  it('turns the mask with the map', () => {
    const h = encodeHidden(3, 2, new Uint8Array([1, 0, 0, 0, 0, 0]))!
    const turned = turnHidden(h, 1)!
    expect([turned.cols, turned.rows]).toEqual([2, 3])
    expect(decodeHidden(turned)).toEqual(new Uint8Array([0, 1, 0, 0, 0, 0]))
  })

  it('softens edges outwards: all that was hidden stays fully hidden', () => {
    const n = 60
    const mask = new Uint8Array(n * n)
    for (let y = 25; y < 35; y++) mask.fill(1, y * n + 25, y * n + 35)
    /** The softened mask as a full grid. */
    const full = (radius: number) => {
      const r = softenHidden(mask, n, n, radius)!
      const out = new Uint8Array(n * n)
      for (let j = 0; j < r.height; j++) out.set(r.pixels.subarray(j * r.width, (j + 1) * r.width), (r.y + j) * n + r.x)
      return out
    }
    expect(full(0)[30 * n + 25]).toBe(255)
    expect(full(0)[30 * n + 24]).toBe(0)
    expect(softenHidden(new Uint8Array(n * n), n, n, 12)).toBeNull()
    const soft = full(12)
    // Every hidden cell, edges and corners too, fully hidden.
    for (let i = 0; i < mask.length; i++) if (mask[i]) expect(soft[i]).toBe(255)
    // Fading out beyond the edge (row 30, leftwards from column 25), and gone further away.
    const row = Array.from({ length: 25 }, (_, x) => soft[30 * n + x])
    expect(row.some((v) => v > 0 && v < 255)).toBe(true)
    for (let x = 1; x < 25; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1])
    expect(row[0]).toBe(0)
  })
})

describe('areas', () => {
  const area = (id: string, x0: number, x1: number): HiddenArea => {
    const g = editableGrid(bounds)
    paintHidden(g, bounds, { x: x0, y: 500 }, { x: x1, y: 500 }, 30, 1)
    return { id, cells: encodeHidden(g.cols, g.rows, g.mask)!, softness: 0.3, revealWithVision: true }
  }

  it('finds the area at a point, its middle, and everything hidden', () => {
    const a = area('a', 100, 300)
    const b = area('b', 600, 800)
    expect(areaAt([a, b], bounds, { x: 700, y: 500 })?.id).toBe('b')
    expect(areaAt([a, b], bounds, { x: 450, y: 500 })).toBeUndefined()
    const c = areaCentre(a, bounds)
    expect(Math.abs(c.x - 200)).toBeLessThan(5)
    expect(Math.abs(c.y - 500)).toBeLessThan(5)
    const union = unionMask([a, b], bounds)!
    expect(union.reduce((n, v) => n + v, 0)).toBe(
      decodeHidden(a.cells).reduce((n, v) => n + v, 0) + decodeHidden(b.cells).reduce((n, v) => n + v, 0),
    )
  })

  it('splits an old single mask into one area per patch', () => {
    const g = editableGrid(bounds)
    paintHidden(g, bounds, { x: 100, y: 100 }, { x: 100, y: 100 }, 30, 1)
    paintHidden(g, bounds, { x: 800, y: 800 }, { x: 800, y: 800 }, 30, 1)
    const areas = legacyAreas(encodeHidden(g.cols, g.rows, g.mask), 0.5)
    expect(areas).toHaveLength(2)
    expect(areas.every((a) => a.softness === 0.5 && a.revealWithVision)).toBe(true)
    expect(legacyAreas(null)).toEqual([])
  })
})
