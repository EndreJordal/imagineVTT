import { describe, expect, it } from 'vitest'
import { detectGrid } from './gridDetect'
import { loadRgb, MAP_DIR, mapFiles, WALLED_DIR, walledMapFiles } from './testMaps'
import { detectWalls, mapImageOf, refineGridByWalls } from './wallDetect'

/**
 * Real maps with walls in test-maps/walled maps/ (not committed; skipped without them).
 * Grids checked by overlaying them on the maps; wall counts are loose sanity bounds, the
 * results having been checked by eye.
 */
const CASES: { file: string; period: number; phase?: [number, number]; walls: [number, number]; note: string }[] = [
  { file: 'cabin.jpg', period: 50.03, walls: [8, 40], note: 'outdoor, log walls' },
  { file: 'crypt.jpg', period: 150, walls: [40, 140], note: 'buildings on grass, in a dark frame' },
  { file: 'dungeon.jpeg', period: 140, phase: [0, 0], walls: [10, 60], note: 'no grid; bricks at 1/3 square' },
  { file: 'mixdungeon.jpg', period: 102.4, phase: [0, 0], walls: [5, 40], note: 'no grid; caves and rooms; bricks at 1/4 square' },
  {
    file: 'sunless_citadel_fortress_level_by_foundryatropos_dcclon0.jpg',
    period: 70,
    walls: [40, 160],
    note: 'grid in rooms, rock between',
  },
]

const available = new Set(walledMapFiles())

function phaseError(a: number, b: number, period: number) {
  const d = Math.abs(a - b) % period
  return Math.min(d, period - d)
}

describe.skipIf(available.size === 0)('walls and grids on real walled maps', () => {
  for (const c of CASES.filter((c) => available.has(c.file))) {
    it(`${c.file} (${c.note})`, { timeout: 120_000 }, async () => {
      const { rgb, gray } = await loadRgb(`${WALLED_DIR}/${c.file}`)
      const map = mapImageOf(rgb)
      const found = refineGridByWalls(map, detectGrid(gray)!)
      expect(Math.abs(found.period - c.period) / c.period).toBeLessThan(0.002)
      if (c.phase) {
        expect(phaseError(found.phaseX, c.phase[0], found.period)).toBeLessThan(0.05 * found.period)
        expect(phaseError(found.phaseY, c.phase[1], found.period)).toBeLessThan(0.05 * found.period)
      }
      const walls = detectWalls(map, { period: c.period, phaseX: found.phaseX, phaseY: found.phaseY })
      expect(walls.length).toBeGreaterThanOrEqual(c.walls[0])
      expect(walls.length).toBeLessThanOrEqual(c.walls[1])
    })
  }
})

describe.skipIf(mapFiles().length === 0)('grid refinement leaves drawn grids alone', () => {
  it('keeps every gridded test map’s detected grid', { timeout: 600_000 }, async () => {
    for (const file of mapFiles()) {
      const { rgb, gray } = await loadRgb(`${MAP_DIR}/${file}`)
      const found = detectGrid(gray)
      if (!found) continue
      expect(refineGridByWalls(mapImageOf(rgb), found).period, file).toBe(found.period)
    }
  })
})
