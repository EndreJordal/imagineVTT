import { describe, expect, it } from 'vitest'
import {
  snapToGrid,
  alignMapToGrid,
  carryPoint,
  followGrid,
  boundingRect,
  fitMapToRect,
  mapScaleForCorner,
  pointInPolygon,
  tableScale,
  tableViewCorners,
  upMarker,
} from './geometry'
import type { Display, Scene } from './types'

const scene: Scene = {
  map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
  grid: { size: 100, offsetX: 0, offsetY: 0, visible: true, color: '#ffffff', opacity: 0.35 },
  squareMm: 25,
  view: { x: 500, y: 500 },
  darkness: 0,
  lights: [],
  fog: { enabled: false },
  walls: [],
}
const display: Display = { pxPerMm: 4, orientation: 0 }

describe('tableScale', () => {
  it('maps one grid square to squareMm physical millimetres', () => {
    // 100 map px -> 25 mm -> 100 screen px
    expect(tableScale(scene, display)).toBe(1)
    expect(tableScale({ ...scene, squareMm: 50 }, display)).toBe(2)
  })
})

describe('tableViewCorners', () => {
  const screen = { width: 400, height: 200 }

  it('is an axis-aligned rect around the view centre at 0°', () => {
    const c = tableViewCorners(scene, display, screen)
    expect(c[0]).toEqual({ x: 300, y: 400 })
    expect(c[2]).toEqual({ x: 700, y: 600 })
  })

  it('swaps extents at 90°', () => {
    const c = tableViewCorners(scene, { ...display, orientation: 90 }, screen)
    const xs = c.map((p) => Math.round(p.x))
    const ys = c.map((p) => Math.round(p.y))
    expect(Math.max(...xs) - Math.min(...xs)).toBe(200)
    expect(Math.max(...ys) - Math.min(...ys)).toBe(400)
  })
})

describe('mapScaleForCorner', () => {
  const map = { x: 0, y: 0, width: 200, height: 100, naturalWidth: 200, naturalHeight: 100 }
  it('returns the scale whose corner lands on the pointer', () => {
    expect(mapScaleForCorner(map, { x: 400, y: 200 })).toBe(2)
    expect(mapScaleForCorner(map, { x: 100, y: 50 })).toBe(0.5)
  })
  it('projects off-diagonal pointers onto the diagonal', () => {
    expect(mapScaleForCorner(map, { x: 200, y: 300 })).toBeCloseTo(1.4)
  })
  it('measures from the map origin', () => {
    expect(mapScaleForCorner({ ...map, x: 50, y: 50 }, { x: 450, y: 250 })).toBe(2)
  })
})

describe('fitMapToRect', () => {
  const map = { x: 0, y: 0, width: 200, height: 100, naturalWidth: 200, naturalHeight: 100 }
  const target = { x: 50, y: 20, width: 400, height: 400 }

  it('fits the width and keeps the vertical centre', () => {
    const m = fitMapToRect(map, target, 'x')
    expect([m.x, m.width, m.height]).toEqual([50, 400, 200])
    expect(m.y + m.height / 2).toBe(50)
  })

  it('fits the height and keeps the horizontal centre', () => {
    const m = fitMapToRect(map, target, 'y')
    expect([m.y, m.width, m.height]).toEqual([20, 800, 400])
    expect(m.x + m.width / 2).toBe(100)
  })
})

describe('alignMapToGrid', () => {
  const map = { x: 30, y: -40, width: 500, height: 400, naturalWidth: 1000, naturalHeight: 800 }
  const grid = { size: 100, offsetX: 10, offsetY: 0, visible: true, color: '#ffffff', opacity: 0.35 }

  it('scales one image cell to one grid square and puts its lines on grid lines', () => {
    const m = alignMapToGrid(map, grid, { period: 50, phaseX: 20, phaseY: 7 })
    expect([m.width, m.height]).toEqual([2000, 1600])
    // Image line at x=20px -> scene m.x + 40, which must be 10 mod 100.
    expect((((m.x + 40 - 10) % 100) + 100) % 100).toBeCloseTo(0)
    expect((((m.y + 14) % 100) + 100) % 100).toBeCloseTo(0)
  })

  it('moves the map by less than one grid square', () => {
    const m = alignMapToGrid(map, grid, { period: 50, phaseX: 20, phaseY: 7 })
    expect(Math.abs(m.x - map.x)).toBeLessThanOrEqual(50)
    expect(Math.abs(m.y - map.y)).toBeLessThanOrEqual(50)
  })
})

describe('followGrid', () => {
  const map = { x: 30, y: -40, width: 500, height: 400, naturalWidth: 1000, naturalHeight: 800 }
  const grid = { size: 100, offsetX: 10, offsetY: 0, visible: true, color: '#ffffff', opacity: 0.35 }

  it('moves the map with the grid offset', () => {
    const m = followGrid(map, grid, { ...grid, offsetX: 35, offsetY: -5 })
    expect([m.x, m.y, m.width]).toEqual([55, -45, 500])
  })

  it('scales the map with the cell size, keeping its place relative to grid lines', () => {
    const m = followGrid(map, grid, { ...grid, size: 50 })
    expect([m.width, m.height]).toEqual([250, 200])
    // The map started 0.2 cells right of a grid line; it still does.
    expect((m.x - 10) / 50).toBeCloseTo((map.x - 10) / 100)
  })
})

describe('carryPoint', () => {
  it('keeps a point on the same spot of a moved and scaled map', () => {
    const from = { x: 0, y: 0, width: 1000, height: 500 }
    const to = { x: 100, y: -50, width: 2000, height: 1000 }
    // A quarter across, a fifth down stays a quarter across, a fifth down.
    expect(carryPoint({ x: 250, y: 100 }, from, to)).toEqual({ x: 600, y: 150 })
  })
})

describe('snapToGrid', () => {
  const grid = { size: 100, offsetX: 10, offsetY: 0, visible: true, color: '#ffffff', opacity: 0.35 }
  it('snaps to grid corners, half and quarter squares, or not at all', () => {
    expect(snapToGrid({ x: 150, y: 40 }, grid, 1)).toEqual({ x: 110, y: 0 })
    expect(snapToGrid({ x: 160, y: 40 }, grid, 0.5)).toEqual({ x: 160, y: 50 })
    expect(snapToGrid({ x: 147, y: 40 }, grid, 0.25)).toEqual({ x: 135, y: 50 })
    expect(snapToGrid({ x: 147, y: 40 }, grid, 0)).toEqual({ x: 147, y: 40 })
  })
})

describe('boundingRect', () => {
  it('bounds rotated table-view corners', () => {
    const c = tableViewCorners(scene, { ...display, orientation: 90 }, { width: 400, height: 200 })
    const r = boundingRect(c)
    expect([Math.round(r.width), Math.round(r.height)]).toEqual([200, 400])
  })
})

describe('upMarker', () => {
  // Which side of the view centre the marker sits on, per table orientation. The sidebar's
  // orientation buttons draw the triangle on these sides, so they must stay in step.
  const side = (orientation: 0 | 90 | 180 | 270) => {
    const corners = tableViewCorners(scene, { ...display, orientation }, { width: 400, height: 200 })
    const tip = upMarker(corners, scene.view, 10)[2]
    const dx = Math.round(tip.x - scene.view.x)
    const dy = Math.round(tip.y - scene.view.y)
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom'
  }

  it('sits on the edge that is up on the table', () => {
    expect([side(0), side(90), side(180), side(270)]).toEqual(['top', 'left', 'bottom', 'right'])
  })
})

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
  it('detects inside and outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
  })
})
