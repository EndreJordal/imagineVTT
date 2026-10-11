import { describe, expect, it } from 'vitest'
import { deleteWallPoints, moveWallPoints, pointsAt, rectBetween, uniquePositions, wallPointsIn, withLinked } from './walls'

const P = (x: number, y: number) => ({ x, y })
const line = { id: 'a', points: [P(0, 0), P(100, 0), P(200, 0), P(300, 0), P(400, 0)] }
let n = 0
const newId = () => `new${++n}`

describe('wall editing', () => {
  it('moves only the chosen points', () => {
    const [w] = moveWallPoints([line], [{ wallId: 'a', index: 1 }], 0, 50)
    expect(w.points.slice(0, 3)).toEqual([P(0, 0), P(100, 50), P(200, 0)])
  })

  it('cuts a wall where a middle point is deleted, leaving a gap', () => {
    n = 0
    const out = deleteWallPoints([line], [{ wallId: 'a', index: 2 }], newId)
    expect(out.map((w) => [w.id, w.points])).toEqual([
      ['a', [P(0, 0), P(100, 0)]],
      ['new1', [P(300, 0), P(400, 0)]],
    ])
  })

  it('drops pieces too short to be walls', () => {
    const out = deleteWallPoints([line], [{ wallId: 'a', index: 1 }, { wallId: 'a', index: 3 }], newId)
    expect(out).toEqual([]) // only single points left between the cuts
  })

  it('shortens a wall when an end point is deleted', () => {
    const out = deleteWallPoints([line], [{ wallId: 'a', index: 4 }], newId)
    expect(out.map((w) => w.points.length)).toEqual([4])
  })

  it('finds the points inside a box drawn either way', () => {
    const box = rectBetween(P(250, 20), P(90, -20))
    expect(wallPointsIn([line], box)).toEqual([
      { wallId: 'a', index: 1 },
      { wallId: 'a', index: 2 },
    ])
  })
})

describe('linked wall points', () => {
  // A closed square (first and last point the same) and a corridor wall starting at its corner.
  const square = { id: 'sq', points: [P(0, 0), P(100, 0), P(100, 100), P(0, 100), P(0, 0)] }
  const corridor = { id: 'c', points: [P(100, 100), P(300, 100)] }
  const walls = [square, corridor]

  it('finds every point at a spot, across walls', () => {
    expect(pointsAt(walls, P(0, 0))).toEqual([
      { wallId: 'sq', index: 0 },
      { wallId: 'sq', index: 4 },
    ])
    expect(pointsAt(walls, P(100, 100))).toEqual([
      { wallId: 'sq', index: 2 },
      { wallId: 'c', index: 0 },
    ])
  })

  it('expands a selection to the points linked with it', () => {
    expect(withLinked(walls, [{ wallId: 'c', index: 0 }, { wallId: 'sq', index: 2 }])).toEqual([
      { wallId: 'sq', index: 2 },
      { wallId: 'c', index: 0 },
    ])
  })

  it('keeps a closed corner closed when its linked points move together', () => {
    const refs = withLinked(walls, [{ wallId: 'sq', index: 0 }])
    const [moved] = moveWallPoints(walls, refs, 10, 0)
    expect([moved.points[0], moved.points[4]]).toEqual([P(10, 0), P(10, 0)])
  })

  it('draws linked points once', () => {
    expect(uniquePositions(square.points)).toHaveLength(4)
  })
})

