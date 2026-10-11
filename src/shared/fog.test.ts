import { describe, expect, it } from 'vitest'
import { createFogMemory, fitsBounds, stampVision, turnFogMemory, visionFalloff } from './fog'

const bounds = { x: 100, y: 50, width: 2000, height: 1000 }
const at = (m: ReturnType<typeof createFogMemory>, sceneX: number, sceneY: number) => {
  const x = Math.floor(((sceneX - bounds.x) / bounds.width) * m.cols)
  const y = Math.floor(((sceneY - bounds.y) / bounds.height) * m.rows)
  return m.data[y * m.cols + x]
}

describe('fog memory', () => {
  it('sizes the grid to the map shape', () => {
    const m = createFogMemory(bounds)
    expect([m.cols, m.rows]).toEqual([512, 256])
    expect(fitsBounds(m, { width: 4000, height: 2000 })).toBe(true) // same map, scaled
    expect(fitsBounds(m, { width: 1000, height: 1000 })).toBe(false) // another map
  })

  it('remembers what a viewer saw, with a soft edge, and nothing beyond', () => {
    const m = createFogMemory(bounds)
    expect(stampVision(m, bounds, [{ x: 600, y: 550, range: 200 }])).toBe(true)
    expect(at(m, 600, 550)).toBe(255) // centre
    expect(at(m, 600 + 150, 550)).toBe(255) // well inside
    const edge = at(m, 600 + 190, 550)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255) // fading
    expect(at(m, 600 + 260, 550)).toBe(0) // beyond range
  })

  it('only reports a change when something new is seen', () => {
    const m = createFogMemory(bounds)
    stampVision(m, bounds, [{ x: 600, y: 550, range: 200 }])
    expect(stampVision(m, bounds, [{ x: 600, y: 550, range: 200 }])).toBe(false)
    expect(stampVision(m, bounds, [{ x: 650, y: 550, range: 200 }])).toBe(true)
  })

  it('ignores viewers off the map', () => {
    const m = createFogMemory(bounds)
    expect(stampVision(m, bounds, [{ x: -5000, y: -5000, range: 100 }])).toBe(false)
  })
})

describe('stampVision with a reach', () => {
  it('only records inside the area sight can reach', () => {
    const m = createFogMemory(bounds)
    const reach = { x: 500, y: 450, width: 200, height: 200 }
    stampVision(m, bounds, [{ x: 600, y: 550, range: 400, reach }])
    expect(at(m, 600, 550)).toBe(255)
    expect(at(m, 600 + 300, 550)).toBe(0) // within range, outside reach
  })
})

describe('visionFalloff', () => {
  it('is full for most of the range and eases out to zero', () => {
    expect(visionFalloff(0)).toBe(1)
    expect(visionFalloff(0.85)).toBe(1)
    expect(visionFalloff(0.925)).toBeCloseTo(0.5)
    expect(visionFalloff(1)).toBe(0)
  })
})

describe('turnFogMemory', () => {
  // 3 wide, 2 tall:  1 2 3
  //                  4 5 6
  const memory = { cols: 3, rows: 2, data: new Uint8Array([1, 2, 3, 4, 5, 6]) }

  it('turns the grid a quarter turn clockwise', () => {
    // 4 1
    // 5 2
    // 6 3
    expect(turnFogMemory(memory, 1)).toEqual({ cols: 2, rows: 3, data: new Uint8Array([4, 1, 5, 2, 6, 3]) })
  })

  it('turns back to where it was', () => {
    expect(turnFogMemory(turnFogMemory(memory, 1), -1)).toEqual(memory)
    expect(turnFogMemory(memory, 4)).toEqual(memory)
    expect(turnFogMemory(memory, 2).data).toEqual(new Uint8Array([6, 5, 4, 3, 2, 1]))
  })
})
