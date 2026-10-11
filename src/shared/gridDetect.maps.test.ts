import { describe, expect, it } from 'vitest'
import { detectGrid, MIN_CONFIDENCE } from './gridDetect'
import { loadMap, mapFiles } from './testMaps'

/**
 * Real battlemaps in test-maps/ (not committed; these tests skip without them), from
 * obvious grids to faint ones under busy art. Expected values were checked by overlaying
 * the detected grid on each map and comparing it with the map's own lines.
 */
const CASES: { file: string; period: number; phase: [number, number]; note: string }[] = [
  { file: '0gegpwj4ix231.jpg', period: 25.714, phase: [25.3, 25.3], note: 'clear thin lines, 42x42' },
  { file: '8pzah5w6w9uh1.jpg', period: 140, phase: [1, 1], note: 'light lines over sketchy art, 28x28' },
  { file: '5imqwdl0xdug1.webp', period: 75, phase: [0, 0], note: 'grid on top half only, illustration below' },
  { file: 'cabin.jpg', period: 50, phase: [49, 49], note: 'lines hidden under trees, 30x30' },
  { file: 'col-arcane.jpg', period: 95.256, phase: [0, 0], note: 'faint, glowing art, 43x28' },
  { file: 'col-day.jpg', period: 140, phase: [0, 0], note: 'same layout as col-arcane at 6020px' },
  { file: 'corrupted fey springs.jpeg', period: 119.042, phase: [107.1, 114], note: 'faint white lines on busy art, 24x42' },
  { file: 'desert skulls.jpg', period: 70, phase: [0, 0], note: 'clear, 25x35' },
  { file: 'dungeon2.jpg', period: 140, phase: [0.5, 0.4], note: 'grid only inside rooms, 40x25' },
  { file: 'e12yk32ff9uh1.jpg', period: 140, phase: [140, 140], note: 'light lines, 22x17' },
  { file: 'gqs6r9b5h7uh1.jpg', period: 44.522, phase: [43.8, 44.2], note: 'three map panels, 33x46' },
  { file: 'hideout.jpeg', period: 227.278, phase: [224, 224], note: 'floor tiles at 1/4 of the grid, 18x22' },
  { file: 'j7pc1twy3q9f1.webp', period: 140, phase: [0, 0], note: 'dark lines on dark stone, 28x32' },
  { file: 'p8cknxyh71uh1.jpg', period: 150, phase: [149.4, 149.5], note: 'tall 4800x8400, 32x56' },
  { file: 'rwrh6w3o6auh1.jpeg', period: 171.659, phase: [171, 171], note: 'dashed lines, 15106x9956, 88x58' },
  { file: 't1ly6tfwtoth1.jpg', period: 150, phase: [0, 0], note: 'forest and river, 6450x6450, 43x43 (user-verified in app)' },
  { file: 'ud7cfs7itpuh1.jpg', period: 140, phase: [0, 0], note: 'light lines over murky art, 28x34' },
  { file: 'vse5vh8lf3uh1.jpg', period: 75, phase: [0, 0], note: 'dark lines on mottled green, 35x35' },
  { file: 'wlj9rhbryswg1.jpg', period: 100, phase: [0, 0], note: 'very faint; cobbles and tiles at 1/5 and 1/2, 18x19' },
]

/** Maps where detection is expected to fail: it must say so, not return a confident guess. */
const UNDETECTABLE = [
  { file: 'h1udfkskbhuh1.jpg', note: 'grid only on narrow corridors amid strong radial lines' },
]

const available = new Set(mapFiles())

/** Distance between two phases on a circle of the given period. */
function phaseError(a: number, b: number, period: number) {
  const d = Math.abs(a - b) % period
  return Math.min(d, period - d)
}

describe.skipIf(available.size === 0)('grid detection on real maps', () => {
  for (const c of CASES.filter((c) => available.has(c.file))) {
    it(`${c.file} (${c.note})`, { timeout: 60_000 }, async () => {
      const result = detectGrid(await loadMap(c.file))
      expect(result).not.toBeNull()
      const { period, phaseX, phaseY, confidence } = result!

      // Over ~40 cells, 0.1% period error is under half a pixel at the far edge.
      expect(Math.abs(period - c.period) / c.period).toBeLessThan(0.001)
      expect(phaseError(phaseX, c.phase[0], period)).toBeLessThan(1.5)
      expect(phaseError(phaseY, c.phase[1], period)).toBeLessThan(1.5)
      expect(confidence).toBeGreaterThan(MIN_CONFIDENCE)
    })
  }

  for (const c of UNDETECTABLE.filter((c) => available.has(c.file))) {
    it(`${c.file} reports low confidence (${c.note})`, { timeout: 60_000 }, async () => {
      const result = detectGrid(await loadMap(c.file))
      expect(result === null || result.confidence < MIN_CONFIDENCE).toBe(true)
    })
  }

  it('every map in test-maps/ has an expectation', () => {
    const known = new Set([...CASES, ...UNDETECTABLE].map((c) => c.file))
    expect([...available].filter((f) => !known.has(f))).toEqual([])
  })
})
