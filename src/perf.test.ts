import { describe, expect, it } from 'vitest'
import { createFogMemory, stampVision } from './shared/fog'
import { editableGrid, encodeHidden, fillHidden, paintHidden, softenHidden } from './shared/hidden'
import { reuse } from './shared/reuse'
import { uniquePositions } from './shared/walls'
import { createVisibilityTest, visibilityPolygon, wallSegments, type Wall } from './shared/visibility'
import { useGm } from './gm/store'

/**
 * Time budgets for the hot paths: what runs on every pointer move, every message to the
 * table, every redraw. Budgets are about ten times what they take on a laptop, so they only
 * fail on a real slowdown (an accidental O(n²), a full-grid pass where a region would do),
 * not on a busy machine.
 */

/** Median time of `runs` calls, in ms, after a warm-up call. */
function time(f: () => void, runs = 7): number {
  f()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    f()
    times.push(performance.now() - t)
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]
}

const bounds = { x: 0, y: 0, width: 5000, height: 5000 }

/** A big map's walls: 40 long walls inside a box. */
const walls: Wall[] = [
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `w${i}`,
    points: [
      { x: 100 * i + 50, y: 200 },
      { x: 100 * i + 50, y: 4800 },
    ],
  })),
  {
    id: 'box',
    points: [
      { x: 40, y: 190 },
      { x: 4960, y: 190 },
      { x: 4960, y: 4810 },
      { x: 40, y: 4810 },
      { x: 40, y: 190 },
    ],
  },
]

describe('performance budgets', () => {
  it('hidden areas: a brush move, softening, filling a room', () => {
    const big = editableGrid(bounds)
    paintHidden(big, bounds, { x: 1000, y: 1000 }, { x: 3000, y: 3000 }, 300, 1)
    const stroke = editableGrid(bounds)
    paintHidden(stroke, bounds, { x: 1000, y: 1000 }, { x: 1300, y: 1100 }, 100, 1)
    const encoded = encodeHidden(big.cols, big.rows, big.mask)

    // One pointer move of the brush: copy the area, paint, encode.
    expect(
      time(() => {
        const g = editableGrid(bounds, encoded)
        paintHidden(g, bounds, { x: 500, y: 500 }, { x: 520, y: 510 }, 100, 1)
        encodeHidden(g.cols, g.rows, g.mask)
      }),
    ).toBeLessThan(10)
    // Softening, on every change to an area (on the GM and the table).
    expect(time(() => softenHidden(stroke.mask, stroke.cols, stroke.rows, 3))).toBeLessThan(5)
    expect(time(() => softenHidden(big.mask, big.cols, big.rows, 20))).toBeLessThan(40)
    expect(time(() => fillHidden(editableGrid(bounds), bounds, walls, { x: 2025, y: 2500 }))).toBeLessThan(30)
  })

  it('sight: line of sight and stamping explored fog', () => {
    const segments = wallSegments(walls)
    const eye = { x: 2025, y: 2500 }
    expect(time(() => visibilityPolygon(eye, 2000, segments))).toBeLessThan(5)
    const sees = createVisibilityTest(eye, visibilityPolygon(eye, 2000, segments))
    expect(time(() => stampVision(createFogMemory(bounds), bounds, [{ ...eye, range: 2000, sees }]), 3)).toBeLessThan(100)
  })

  it('a message to the table that changes nothing is cheap, and draws nothing', () => {
    const scene = {
      walls: Array.from({ length: 500 }, (_, i) => ({ id: `w${i}`, points: [{ x: i, y: 0 }, { x: i, y: 10 }] })),
      lights: Array.from({ length: 50 }, (_, i) => ({ id: `l${i}`, x: i, y: i, radius: 4, color: '#ffffff' })),
    }
    const copy = structuredClone(scene)
    expect(reuse(scene, copy)).toBe(scene)
    expect(time(() => reuse(scene, structuredClone(scene)))).toBeLessThan(20)
  })

  it('wall points: linked points found without comparing every pair', () => {
    const points = Array.from({ length: 20000 }, (_, i) => ({ x: i % 5000, y: Math.floor(i / 5000) }))
    expect(time(() => uniquePositions(points), 3)).toBeLessThan(50)
  })

  it('store: a brush stroke over a floor with many hidden areas', () => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        map: { x: 0, y: 0, width: 5000, height: 5000, naturalWidth: 5000, naturalHeight: 5000 },
        grid: { ...s.scene.grid, size: 100 },
        hiddenAreas: [],
      },
      hideBrush: 1,
    }))
    const { hidePaint } = useGm.getState()
    for (let i = 0; i < 20; i++) hidePaint({ x: 200 + i * 230, y: 300 }, { x: 260 + i * 230, y: 320 }, false, `a${i}`)
    expect(useGm.getState().scene.hiddenAreas).toHaveLength(20)
    let x = 1000
    // A move of a new stroke, and an erase move (which checks every area).
    expect(time(() => hidePaint({ x, y: 3000 }, { x: (x += 10), y: 3005 }, false, 'stroke'))).toBeLessThan(10)
    expect(time(() => hidePaint({ x: 4000, y: 4000 }, { x: 4010, y: 4005 }, true, 'erase'))).toBeLessThan(10)
  })
})
