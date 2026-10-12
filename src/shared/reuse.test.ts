import { describe, expect, it } from 'vitest'
import { reuse } from './reuse'

describe('reuse', () => {
  const prev = { lights: [{ id: 'a', x: 1 }, { id: 'b', x: 2 }], walls: [{ points: [{ x: 0, y: 0 }] }], view: { x: 5, y: 5 } }

  it('returns the previous object when nothing changed (a fresh copy)', () => {
    expect(reuse(prev, structuredClone(prev))).toBe(prev)
  })

  it('keeps unchanged parts and replaces changed ones', () => {
    const next = structuredClone(prev)
    next.lights[1].x = 3
    const r = reuse(prev, next)
    expect(r).not.toBe(prev)
    expect(r).toEqual(next)
    expect(r.walls).toBe(prev.walls)
    expect(r.view).toBe(prev.view)
    expect(r.lights[0]).toBe(prev.lights[0])
    expect(r.lights[1]).not.toBe(prev.lights[1])
  })

  it('handles added and removed items and keys', () => {
    const next = structuredClone(prev)
    next.lights.pop()
    const r = reuse(prev, next)
    expect(r.lights).toEqual([prev.lights[0]])
    expect(r.lights[0]).toBe(prev.lights[0])
    expect(reuse({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 })
    expect(reuse(null, prev)).toBe(prev)
  })
})
