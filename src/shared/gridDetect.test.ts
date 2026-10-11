import { describe, expect, it } from 'vitest'
import { detectGrid, MIN_CONFIDENCE, type GrayImage } from './gridDetect'

/** Deterministic pseudo-random numbers so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function image(width: number, height: number, pixel: (x: number, y: number) => number): GrayImage {
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = pixel(x, y)
  return { width, height, data }
}

/**
 * How much of pixel v (covering [v, v+1)) a 1px grid line covers, 0..1. Lines are
 * anti-aliased like exported maps: a line at a fractional position spreads over two pixels.
 */
const line = (v: number, period: number, phase: number) => {
  const m = (((v + 0.5 - (phase + 0.5)) % period) + period) % period
  return Math.max(0, 1 - Math.min(m, period - m))
}
const onGrid = (x: number, y: number, period: number, phase: number) =>
  Math.max(line(x, period, phase), line(y, period, phase))

describe('detectGrid', () => {
  it('finds a clean grid with a fractional period', () => {
    const noise = rng(1)
    const img = image(900, 700, (x, y) => {
      const ink = Math.max(line(x, 37.5, 10), line(y, 37.5, 22))
      return 0.7 + noise() * 0.05 - 0.4 * ink
    })
    const g = detectGrid(img)!
    expect(Math.abs(g.period - 37.5)).toBeLessThan(0.1)
    expect(Math.abs(g.phaseX - 10)).toBeLessThan(1)
    expect(Math.abs(g.phaseY - 22)).toBeLessThan(1)
    expect(g.confidence).toBeGreaterThan(MIN_CONFIDENCE)
  })

  it('prefers the grid over a bolder texture that repeats at a fraction of it', () => {
    // Faint grid every 60px across the whole map; bold 20px cobbles (running bond: vertical
    // joints shift half a stone every row) in a courtyard and a street, like the
    // Brasstacks test map.
    const noise = rng(2)
    const inCobbles = (x: number, y: number) => (x > 100 && x < 500 && y > 80 && y < 700) || y > 760
    const cobbleJoint = (x: number, y: number) => {
      const row = Math.floor((y - 5) / 20)
      return Math.max(line(y, 20, 5), line(x, 20, 5 + (row % 2) * 10))
    }
    const img = image(1200, 900, (x, y) => {
      let v = 0.6 + noise() * 0.04
      if (inCobbles(x, y)) v -= 0.3 * cobbleJoint(x, y)
      return v - 0.1 * onGrid(x, y, 60, 5)
    })
    const g = detectGrid(img)!
    expect(Math.abs(g.period - 60)).toBeLessThan(0.1)
    expect(Math.abs(g.phaseX - 5)).toBeLessThan(1.5)
  })

  it('reports low confidence when there is no grid', () => {
    const noise = rng(3)
    // Smooth blobs plus fine noise: structure, but nothing periodic.
    const blobs = Array.from({ length: 40 }, () => [noise() * 800, noise() * 600, 20 + noise() * 80])
    const img = image(800, 600, (x, y) => {
      let v = 0.5 + noise() * 0.06
      for (const [bx, by, r] of blobs) if ((x - bx) ** 2 + (y - by) ** 2 < r * r) v -= 0.08
      return v
    })
    const g = detectGrid(img)
    expect(g === null || g.confidence < MIN_CONFIDENCE).toBe(true)
  })
})
