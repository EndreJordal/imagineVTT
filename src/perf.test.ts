import { describe, expect, it } from 'vitest'
import { createFogMemory, stampVision } from './shared/fog'
import { editableGrid, encodeHidden, fillHidden, paintHidden, softenHidden } from './shared/hidden'
import { reuse } from './shared/reuse'
import { uniquePositions } from './shared/walls'
import { createVisibilityTest, visibilityPolygon, wallSegments, type Wall } from './shared/visibility'
import { useGm } from './gm/store'
import { seenTokens, type CharacterToken } from './shared/characters'
import { orderFor } from './shared/combat'
import { extractLevel } from './shared/levels'
import { createLight } from './shared/lights'
import { readSceneFile, writeSceneFile } from './shared/sceneFile'
import type { Scene } from './shared/types'

/**
 * Time budgets for the hot paths: what runs on every pointer move, every message to the
 * table, every redraw. Budgets are about ten times what they take on a laptop, so they only
 * fail on a real slowdown (an accidental O(n²), a full-grid pass where a region would do),
 * not on a busy machine.
 */

/** Median time of `runs` calls, in ms, after a warm-up call. */
function time(f: () => void, runs = 7): number {
  f()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    f()
    times.push(performance.now() - t)
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)]
}

const bounds = { x: 0, y: 0, width: 5000, height: 5000 }

/** A big map's walls: 40 long walls inside a box. */
const walls: Wall[] = [
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `w${i}`,
    points: [
      { x: 100 * i + 50, y: 200 },
      { x: 100 * i + 50, y: 4800 },
    ],
  })),
  {
    id: 'box',
    points: [
      { x: 40, y: 190 },
      { x: 4960, y: 190 },
      { x: 4960, y: 4810 },
      { x: 40, y: 4810 },
      { x: 40, y: 190 },
    ],
  },
]

describe('performance budgets', () => {
  it('hidden areas: a brush move, softening, filling a room', () => {
    const big = editableGrid(bounds)
    paintHidden(big, bounds, { x: 1000, y: 1000 }, { x: 3000, y: 3000 }, 300, 1)
    const stroke = editableGrid(bounds)
    paintHidden(stroke, bounds, { x: 1000, y: 1000 }, { x: 1300, y: 1100 }, 100, 1)
    const encoded = encodeHidden(big.cols, big.rows, big.mask)

    // One pointer move of the brush: copy the area, paint, encode.
    expect(
      time(() => {
        const g = editableGrid(bounds, encoded)
        paintHidden(g, bounds, { x: 500, y: 500 }, { x: 520, y: 510 }, 100, 1)
        encodeHidden(g.cols, g.rows, g.mask)
      }),
    ).toBeLessThan(10)
    // Softening, on every change to an area (on the GM and the table).
    expect(time(() => softenHidden(stroke.mask, stroke.cols, stroke.rows, 3))).toBeLessThan(5)
    expect(time(() => softenHidden(big.mask, big.cols, big.rows, 20))).toBeLessThan(40)
    expect(time(() => fillHidden(editableGrid(bounds), bounds, walls, { x: 2025, y: 2500 }))).toBeLessThan(30)
  })

  it('sight: line of sight and stamping explored fog', () => {
    const segments = wallSegments(walls)
    const eye = { x: 2025, y: 2500 }
    expect(time(() => visibilityPolygon(eye, 2000, segments))).toBeLessThan(5)
    const sees = createVisibilityTest(eye, visibilityPolygon(eye, 2000, segments))
    expect(time(() => stampVision(createFogMemory(bounds), bounds, [{ ...eye, range: 2000, sees }]), 3)).toBeLessThan(100)
  })

  it('a message to the table that changes nothing is cheap, and draws nothing', () => {
    const scene = {
      walls: Array.from({ length: 500 }, (_, i) => ({ id: `w${i}`, points: [{ x: i, y: 0 }, { x: i, y: 10 }] })),
      lights: Array.from({ length: 50 }, (_, i) => ({ id: `l${i}`, x: i, y: i, radius: 4, color: '#ffffff' })),
    }
    const copy = structuredClone(scene)
    expect(reuse(scene, copy)).toBe(scene)
    expect(time(() => reuse(scene, structuredClone(scene)))).toBeLessThan(20)
  })

  it('wall points: linked points found without comparing every pair', () => {
    const points = Array.from({ length: 20000 }, (_, i) => ({ x: i % 5000, y: Math.floor(i / 5000) }))
    expect(time(() => uniquePositions(points), 3)).toBeLessThan(50)
  })

  it('store: a brush stroke over a floor with many hidden areas', () => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        map: { x: 0, y: 0, width: 5000, height: 5000, naturalWidth: 5000, naturalHeight: 5000 },
        grid: { ...s.scene.grid, size: 100 },
        hiddenAreas: [],
      },
      hideBrush: 1,
    }))
    const { hidePaint } = useGm.getState()
    for (let i = 0; i < 20; i++) hidePaint({ x: 200 + i * 230, y: 300 }, { x: 260 + i * 230, y: 320 }, false, `a${i}`)
    expect(useGm.getState().scene.hiddenAreas).toHaveLength(20)
    let x = 1000
    // A move of a new stroke, and an erase move (which checks every area).
    expect(time(() => hidePaint({ x, y: 3000 }, { x: (x += 10), y: 3005 }, false, 'stroke'))).toBeLessThan(10)
    expect(time(() => hidePaint({ x: 4000, y: 4000 }, { x: 4010, y: 4005 }, true, 'erase'))).toBeLessThan(10)
  })

  // A big fight: 30 combatants with tokens, 6 vision tokens and 15 lights on the walled map.
  const fighters = Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`,
    name: `Fighter ${i}`,
    type: 'Vampire',
    side: 'npc' as const,
    allegiance: 'enemy' as const,
    state: 'active',
    inactive: false,
    acted: false,
    init: 30 - i,
    portrait: '',
    vtt: null,
  }))
  const tokens: CharacterToken[] = fighters.map((c, i) => ({
    id: `t${i}`,
    name: c.name,
    x: 150 + (i % 10) * 450,
    y: 300 + Math.floor(i / 10) * 1500,
    size: 1,
    border: 'plain',
    color: '#b03a2e',
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    visible: true,
    snap: true,
    ref: c.id,
  }))
  const fightScene = (): Scene => ({
    ...useGm.getState().scene,
    walls,
    darkness: 1,
    fog: { mode: 'full', safety: true },
    hiddenAreas: [],
    lights: [
      ...Array.from({ length: 6 }, (_, i) => ({ ...createLight('vision', 300 + i * 700, 2500, `v${i}`), vision: true, visionRange: 20 })),
      ...Array.from({ length: 15 }, (_, i) => ({ ...createLight('torch', 200 + i * 300, 1000 + (i % 3) * 1200, `l${i}`), on: true })),
    ],
    characters: tokens,
  })

  it('combat: who the players see, and the order the table shows', () => {
    const scene = fightScene()
    const summary = { name: 'Fight', round: 2, phase: 'act', activeId: 'c3', order: fighters.map((c) => c.id), combatants: fighters }
    const seen = time(() => void seenTokens(scene))
    const order = time(() => void orderFor(summary, tokens, seenTokens(scene), () => null))
    console.log(`combat: seen ${seen.toFixed(2)} ms, order (with seen) ${order.toFixed(2)} ms`)
    expect(seen).toBeLessThan(30)
    expect(order).toBeLessThan(30)
  })

  it("combat: the tracker's report, and moving many tokens together", () => {
    useGm.setState({
      scene: fightScene(),
      combat: { linkId: 'perf', encounter: 'Fight', summary: null, snapshot: null, showOrder: true },
    })
    const { receiveTrackerState, moveCharacters } = useGm.getState()
    let round = 0
    const report = time(() => {
      round++
      const summary = { name: 'Fight', round, phase: 'act', activeId: 'c1', order: [], combatants: fighters }
      receiveTrackerState('perf', summary, { combat: { round } })
    })
    const ids = tokens.map((t) => t.id)
    const move = time(() => moveCharacters(ids, 100, 0))
    console.log(`combat: tracker report ${report.toFixed(2)} ms, moving 30 tokens ${move.toFixed(2)} ms`)
    expect(report).toBeLessThan(10)
    expect(move).toBeLessThan(10)
  })

  it('combat: a scene file with a big fight saved in it', async () => {
    // A fight's snapshot: 30 combatants with stats and a long log (about 150 KB of JSON).
    const snapshot = {
      combat: {
        combatants: fighters.map((c) => ({ ...c, attrs: [3, 3, 3, 2, 2, 2, 3, 3, 3], notes: 'x'.repeat(2000) })),
        log: Array.from({ length: 200 }, (_, i) => ({ t: 'T1', html: `<b>Fighter ${i}</b> rolls ${'d'.repeat(200)}` })),
      },
      weapons: [],
    }
    const file = {
      scene: fightScene(),
      levels: [extractLevel(fightScene(), { id: 'f', name: 'Floor' })],
      levelId: 'f',
      tableLevelId: 'f',
      mapImages: { f: null },
      fogMemories: { f: null },
      orientation: 0 as const,
      camera: null,
      objectImages: {},
      soundClips: {},
      combat: { linkId: 'l', encounter: 'Fight', summary: null, snapshot, showOrder: true },
    }
    const t0 = performance.now()
    const back = await readSceneFile(await writeSceneFile(file))
    const ms = performance.now() - t0
    console.log(`combat: save and open a scene with a ${Math.round(JSON.stringify(snapshot).length / 1000)} KB fight: ${ms.toFixed(1)} ms`)
    expect(back.combat?.snapshot).toEqual(snapshot)
    expect(ms).toBeLessThan(500)
  })
})
