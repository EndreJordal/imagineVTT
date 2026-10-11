import { describe, expect, it } from 'vitest'
import { createVisibilityTest, visibilityPolygon, wallSegments, type Segment } from './visibility'

const origin = { x: 0, y: 0 }
const visible = (segments: Segment[], p: { x: number; y: number }, range = 100) =>
  createVisibilityTest(origin, visibilityPolygon(origin, range, segments))(p)

describe('visibility', () => {
  it('sees everything in range with no walls', () => {
    expect(visible([], { x: 50, y: 50 })).toBe(true)
    expect(visible([], { x: -90, y: 20 })).toBe(true)
  })

  it('does not see behind a wall, but does see beside it', () => {
    // A wall across the right side, from (30,-20) to (30,20).
    const wall = [{ a: { x: 30, y: -20 }, b: { x: 30, y: 20 } }]
    expect(visible(wall, { x: 20, y: 0 })).toBe(true) // in front
    expect(visible(wall, { x: 60, y: 0 })).toBe(false) // directly behind
    expect(visible(wall, { x: 60, y: 30 })).toBe(false) // in its shadow, which widens
    expect(visible(wall, { x: 60, y: 60 })).toBe(true) // past its end
    expect(visible(wall, { x: -60, y: 0 })).toBe(true) // the other way
  })

  it('sees through a gap between walls (a doorway)', () => {
    const walls = wallSegments([
      { id: 'w', points: [{ x: 40, y: -50 }, { x: 40, y: -5 }] },
      { id: 'w2', points: [{ x: 40, y: 5 }, { x: 40, y: 50 }] },
    ])
    expect(visible(walls, { x: 80, y: 0 })).toBe(true) // through the gap
    expect(visible(walls, { x: 80, y: 30 })).toBe(false) // behind the lower wall
  })

  it('is enclosed by a room around the viewer', () => {
    const room = wallSegments([
      { id: 'r', points: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }, { x: -20, y: -20 }] },
    ])
    expect(visible(room, { x: 10, y: 10 })).toBe(true)
    expect(visible(room, { x: 30, y: 0 })).toBe(false)
    expect(visible(room, { x: 0, y: -50 })).toBe(false)
  })

  it('ignores walls out of range', () => {
    const far = [{ a: { x: 500, y: -20 }, b: { x: 500, y: 20 } }]
    expect(visibilityPolygon(origin, 100, far).length).toBeGreaterThan(3)
    expect(visible(far, { x: 90, y: 0 })).toBe(true)
  })
})
