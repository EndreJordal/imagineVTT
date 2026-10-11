import { describe, expect, it } from 'vitest'
import { NIGHT_DIMMING, nightMatrix } from './night'

/** Apply a 4x5 matrix to an RGB colour (alpha 1). */
function apply(m: number[], [r, g, b]: number[]) {
  return [0, 1, 2].map((i) => m[i * 5] * r + m[i * 5 + 1] * g + m[i * 5 + 2] * b + m[i * 5 + 3] + m[i * 5 + 4])
}

describe('nightMatrix', () => {
  it('is the identity at day', () => {
    expect(apply(nightMatrix(0), [0.9, 0.4, 0.1])).toEqual([0.9, 0.4, 0.1])
  })

  it('dims greys without tinting them', () => {
    const [r, g, b] = apply(nightMatrix(1), [0.8, 0.8, 0.8])
    expect(r).toBeCloseTo(0.8 * (1 - NIGHT_DIMMING))
    expect(g).toBeCloseTo(r)
    expect(b).toBeCloseTo(r)
  })

  it('drains colour as it gets darker', () => {
    const spread = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c)
    const red = [0.9, 0.2, 0.1]
    expect(spread(apply(nightMatrix(0.5), red))).toBeLessThan(spread(red))
    expect(spread(apply(nightMatrix(1), red))).toBeLessThan(spread(apply(nightMatrix(0.5), red)))
  })
})
