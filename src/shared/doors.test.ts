import { describe, expect, it } from 'vitest'
import { DEFAULT_DOOR_REVEAL, doorMiddle, doorReveal, openedDoors } from './doors'
import type { Wall } from './visibility'

const door = (open: boolean, reveal?: { effect: 'wipe'; duration: number }): Wall => ({
  id: 'd',
  points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  door: { open, ...(reveal && { reveal }) },
})

describe('doors', () => {
  it('finds the doors just opened', () => {
    expect(openedDoors([door(false)], [door(true)]).map((w) => w.id)).toEqual(['d'])
    expect(openedDoors([door(true)], [door(false)])).toEqual([])
    expect(openedDoors([], [door(true)])).toEqual([]) // a new door isn't an opening
  })

  it("uses a door's own reveal, else the scene's, else the default", () => {
    expect(doorReveal({}, door(true))).toEqual(DEFAULT_DOOR_REVEAL)
    expect(doorReveal({ doorReveal: { effect: 'fade', duration: 2 } }, door(true)).effect).toBe('fade')
    expect(doorReveal({ doorReveal: { effect: 'fade', duration: 2 } }, door(true, { effect: 'wipe', duration: 1 })).effect).toBe('wipe')
    expect(doorMiddle(door(true).points)).toEqual({ x: 5, y: 0 })
  })
})
