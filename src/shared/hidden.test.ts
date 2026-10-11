import { describe, expect, it } from 'vitest'
import {
  decodeHidden,
  editableMask,
  encodeHidden,
  fillHidden,
  paintHidden,
  softenHidden,
  turnHidden,
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
const hiddenAt = (g: ReturnType<typeof editableMask>, x: number, y: number) =>
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
    const g = editableMask(null, bounds)
    expect(fillHidden(g, bounds, room, { x: 500, y: 500 })).toBe('filled')
    expect(hiddenAt(g, 500, 500)).toBe(1)
    expect(hiddenAt(g, 405, 500)).toBe(1)
    expect(hiddenAt(g, 300, 500)).toBe(0)
    expect(hiddenAt(g, 700, 700)).toBe(0)
  })

  it("refuses a space that isn't enclosed", () => {
    const open: Wall[] = [{ id: 'w', points: room[0].points.slice(0, 4) }] // three sides
    const g = editableMask(null, bounds)
    expect(fillHidden(g, bounds, open, { x: 500, y: 500 })).toBe('open')
    expect(g.mask.every((v) => v === 0)).toBe(true)
  })

  it('counts doors as part of the outline, open or not', () => {
    const walls: Wall[] = [
      { id: 'w', points: room[0].points.slice(0, 4) },
      { id: 'd', points: [room[0].points[3], room[0].points[4]], door: { open: true } },
    ]
    const g = editableMask(null, bounds)
    expect(fillHidden(g, bounds, walls, { x: 500, y: 500 })).toBe('filled')
  })

  it('reveals a hidden patch when clicked again', () => {
    const g = editableMask(null, bounds)
    fillHidden(g, bounds, room, { x: 500, y: 500 })
    expect(fillHidden(g, bounds, room, { x: 500, y: 500 })).toBe('revealed')
    expect(g.mask.every((v) => v === 0)).toBe(true)
  })
})

describe('the brush', () => {
  it('paints and erases along a stroke', () => {
    const g = editableMask(null, bounds)
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

  it('softens edges, and leaves a hard mask at radius 0', () => {
    const mask = new Uint8Array(20 * 20)
    for (let y = 5; y < 15; y++) mask.fill(1, y * 20 + 5, y * 20 + 15)
    expect(softenHidden(mask, 20, 20, 0)[10 * 20 + 10]).toBe(255)
    const soft = softenHidden(mask, 20, 20, 4)
    expect(soft[10 * 20 + 10]).toBeGreaterThan(200)
    expect(soft[10 * 20 + 5]).toBeLessThan(220)
    expect(soft[10 * 20 + 3]).toBeGreaterThan(0)
  })
})
