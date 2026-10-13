import { describe, expect, it } from 'vitest'
import { moveCrossesWall, wallSegments } from './visibility'
import {
  deleteWallPoints,
  makeDoor,
  moveWallPoints,
  pointsAt,
  rectBetween,
  sameSpot,
  selectedSegment,
  uniquePositions,
  wallPointsIn,
  withLinked,
} from './walls'

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


describe('moveCrossesWall', () => {
  const wall = [{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }]
  it('blocks moves across a wall, or onto it, but not along or past its ends', () => {
    expect(moveCrossesWall({ x: 50, y: -10 }, { x: 50, y: 10 }, wall)).toBe(true)
    expect(moveCrossesWall({ x: 50, y: -10 }, { x: 50, y: 0 }, wall)).toBe(true)
    expect(moveCrossesWall({ x: 50, y: -10 }, { x: 60, y: -1 }, wall)).toBe(false)
    expect(moveCrossesWall({ x: 150, y: -10 }, { x: 150, y: 10 }, wall)).toBe(false)
    // Through the very end of the wall counts: no slipping through where walls meet.
    expect(moveCrossesWall({ x: 90, y: -10 }, { x: 110, y: 10 }, wall)).toBe(true)
  })
  it('lets a token that sits on a wall step off it either way', () => {
    expect(moveCrossesWall({ x: 50, y: 0 }, { x: 50, y: 10 }, wall)).toBe(false)
    expect(moveCrossesWall({ x: 50, y: 0 }, { x: 50, y: -10 }, wall)).toBe(false)
  })
})

describe('doors', () => {
  const room = { id: 'r', points: [P(0, 0), P(400, 0), P(400, 300), P(0, 300), P(0, 0)] }
  let k = 0
  const id = () => `d${++k}`

  it('cuts the wall where a door goes, and puts a closed door in the gap', () => {
    k = 0
    const out = makeDoor([room], P(100, 0), P(200, 0), id)!
    expect(out.map((w) => [w.id, w.points, w.door ?? null])).toEqual([
      ['r', [P(0, 0), P(100, 0)], null],
      ['d1', [P(200, 0), P(400, 0), P(400, 300), P(0, 300), P(0, 0)], null],
      ['d2', [P(100, 0), P(200, 0)], { open: false }],
    ])
  })

  it('shares a wall point when the door ends on one', () => {
    k = 0
    const out = makeDoor([room], P(400, 100), P(400, 300), id)! // ends on the corner
    const door = out.find((w) => w.door)!
    expect(door.points).toEqual([P(400, 100), P(400, 300)])
    // The wall now runs from the corner on: the corner is shared by wall and door.
    expect(out.some((w) => !w.door && sameSpot(w.points[0], P(400, 300)))).toBe(true)
  })

  it('puts a door across the gap between two walls ends', () => {
    k = 0
    const top = { id: 't', points: [P(200, 0), P(200, 100)] }
    const bottom = { id: 'b', points: [P(200, 300), P(200, 400)] }
    const out = makeDoor([top, bottom], P(200, 100), P(200, 300), id)!
    expect(out.slice(0, 2)).toEqual([top, bottom]) // the walls stay as they were
    expect(out[2]).toEqual({ id: 'd1', points: [P(200, 100), P(200, 300)], door: { open: false } })
    // Only between wall points: a loose end isn't a doorway.
    expect(makeDoor([top, bottom], P(200, 100), P(250, 300), id)).toBeNull()
  })

  it('replaces the wall between two corners of one wall, however many lie between', () => {
    k = 0
    // A freeform wall: the corners between the door's ends sit a hair off the straight line.
    const long = { id: 'w', points: [P(200, 0), P(200, 100), P(200.4, 200), P(200, 300), P(200, 400)] }
    const out = makeDoor([long], P(200, 100), P(200, 300), id)!
    expect(out.map((w) => [w.id, w.points, w.door ?? null])).toEqual([
      ['w', [P(200, 0), P(200, 100)], null],
      ['d2', [P(200, 300), P(200, 400)], null],
      ['d1', [P(200, 100), P(200, 300)], { open: false }],
    ])
  })

  it('replaces the shorter way round a closed shape', () => {
    k = 0
    // Corners 0, 1, 2, 3 of a room: a door between 1 and 3 replaces 1 > 2 > 3 (two sides).
    const out = makeDoor([room], P(400, 0), P(0, 300), id)!
    const door = out.find((w) => w.door)!
    expect(door.points).toEqual([P(400, 0), P(0, 300)])
    const wall = out.filter((w) => !w.door)
    expect(wall).toHaveLength(1)
    // What's left runs from one end of the door to the other, the long way (via the corner at 0,0).
    expect(wall[0].points).toEqual([P(0, 300), P(0, 0), P(400, 0)])
  })

  it('refuses points that are not on one stretch of wall', () => {
    expect(makeDoor([room], P(100, 0), P(400, 100), id)).toBeNull() // around a corner
    expect(makeDoor([room], P(100, 10), P(200, 0), id)).toBeNull() // off the line
    expect(makeDoor([room], P(100, 0), P(100, 0), id)).toBeNull() // no width
  })

  it('lets sight through open doors only', () => {
    const [door] = makeDoor([room], P(100, 0), P(200, 0), id)!.filter((w) => w.door)
    expect(wallSegments([door])).toHaveLength(1)
    expect(wallSegments([{ ...door, door: { open: true } }])).toHaveLength(0)
  })

  it('offers converting two neighbouring wall points', () => {
    expect(selectedSegment([room], [{ wallId: 'r', index: 1 }, { wallId: 'r', index: 2 }])).toEqual({
      a: P(400, 0),
      b: P(400, 300),
    })
    // The closed loop's start and end are one point: index 0 and 4 with index 3 neighbour.
    expect(selectedSegment([room], [{ wallId: 'r', index: 4 }, { wallId: 'r', index: 3 }])).not.toBeNull()
    expect(selectedSegment([room], [{ wallId: 'r', index: 0 }, { wallId: 'r', index: 2 }])).toBeNull()
  })
})
