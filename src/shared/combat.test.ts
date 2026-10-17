import { describe, expect, it } from 'vitest'
import {
  combatantLook,
  oppositeEdge,
  orderFor,
  turnMoved,
  type TurnMove,
  orderPlacement,
  portraitKeyOf,
  readCombatLink,
  sceneFileName,
  writeCombatLink,
  type Combatant,
  type CombatSummary,
} from './combat'

const fighter = (over: Partial<Combatant>): Combatant => ({
  id: 'x',
  name: 'X',
  type: 'Vampire',
  side: 'npc',
  allegiance: 'enemy',
  state: 'active',
  inactive: false,
  acted: false,
  init: 10,
  portrait: '',
  vtt: null,
  ...over,
})

describe('combat links', () => {
  it('reads what the campaign bible writes, names with dashes and all', () => {
    const encounter = { name: 'The Record Shop — Fire in the Dubbing Room', combatants: [{ preset: 'neonate' }] }
    const link = readCombatLink(writeCombatLink({ scene: 'The Record Shop - Fire', encounter }))
    expect(link).toEqual({ scene: 'The Record Shop - Fire', encounter })
    expect(readCombatLink('#combat=not-json')).toBeNull()
    expect(readCombatLink('#encounter=abc')).toBeNull()
    // No scene: the fight goes into the open scene.
    expect(readCombatLink(writeCombatLink({ encounter }))?.scene).toBeNull()
  })

  it('names scene files after their scene, minus what file names cannot hold', () => {
    expect(sceneFileName('The Dakota Building - Ventrue Enforcer Ambush')).toBe(
      'The Dakota Building - Ventrue Enforcer Ambush.ivtt',
    )
    expect(sceneFileName('A: B/C? "D" ')).toBe('A- B-C- -D-.ivtt')
    expect(sceneFileName('...')).toBe('Untitled scene.ivtt')
  })

  it("gives a token its encounter's look, else a plain ring in its side's colour", () => {
    expect(combatantLook(fighter({ allegiance: 'enemy', type: 'Brujah' }))).toEqual({
      border: 'plain',
      color: '#b03a2e',
      size: 1,
      label: 'name',
      type: 'Brujah',
    })
    expect(combatantLook(fighter({ allegiance: 'ally' })).color).toBe('#2e8b57')
    const look = combatantLook(fighter({ vtt: { border: 'gold', size: 2, label: 'both', color: 'red' } }))
    expect(look).toMatchObject({ border: 'gold', size: 2, label: 'both', color: '#b03a2e' })
  })

  it('keeps portrait keys short and the same for the same picture', () => {
    const a = portraitKeyOf('https://example.org/images/presets/neonate.jpg')
    expect(a).toMatch(/^combatant:[0-9a-z]+$/)
    expect(portraitKeyOf('https://example.org/images/presets/neonate.jpg')).toBe(a)
    expect(portraitKeyOf('data:image/jpeg;base64,' + 'A'.repeat(5000))).not.toBe(a)
  })
})

describe('where the order goes', () => {
  it('reads fights saved before edges and facing', () => {
    expect(orderPlacement({ edges: 'both' })).toEqual({ edge: 'bottom', facing: 'out', both: true })
    expect(orderPlacement({ edges: 'top' })).toEqual({ edge: 'top', facing: 'out', both: false })
    expect(orderPlacement({ edge: 'left', facing: 'in' })).toEqual({ edge: 'left', facing: 'in', both: false })
    expect(oppositeEdge('left')).toBe('right')
  })
})

describe("the players' order", () => {
  const summary: CombatSummary = {
    name: 'Fight',
    round: 2,
    phase: 'act',
    activeId: 'pc',
    order: ['pc', 'seen', 'ambusher', 'unplaced', 'reserve'],
    combatants: [
      fighter({ id: 'pc', name: 'Anna', side: 'pc', allegiance: 'ally', portrait: 'p.jpg' }),
      fighter({ id: 'seen', name: 'Seen', acted: true }),
      fighter({ id: 'ambusher', name: 'Ambusher' }),
      fighter({ id: 'unplaced', name: 'Unplaced', state: 'dead' }),
      fighter({ id: 'reserve', name: 'Reserve', inactive: true }),
    ],
  }
  const tokens = [
    { id: 't1', ref: 'seen' },
    { id: 't2', ref: 'ambusher' },
  ]

  it('shows the fight in order, but not reinforcements or enemies out of sight', () => {
    const placement = { edge: 'left' as const, facing: 'in' as const, both: true }
    const strip = orderFor(summary, tokens, new Set(['t1']), (url) => `key:${url}`, placement)
    expect(strip.entries.map((e) => e.id)).toEqual(['pc', 'seen', 'unplaced'])
    expect(strip).toMatchObject({ round: 2, phase: 'act', placement })
    expect(strip.entries.map((e) => e.init)).toEqual([10, 10, 10])
    expect(strip.entries[0]).toMatchObject({ active: true, portrait: 'key:p.jpg', side: 'pc' })
    expect(strip.entries[1]).toMatchObject({ active: false, acted: true, portrait: null })
    expect(strip.entries[2].down).toBe(true)
  })

  it('shows an ambusher once the players can see its token', () => {
    const strip = orderFor(summary, tokens, new Set(['t1', 't2']), () => null)
    expect(strip.entries.map((e) => e.id)).toEqual(['pc', 'seen', 'ambusher', 'unplaced'])
  })
})

describe('movement on a turn', () => {
  const at = (x: number, y: number) => ({ x: x * 100 + 50, y: y * 100 + 50 })
  const step = (turn: TurnMove | null, from: [number, number], to: [number, number], arrowKey: boolean) =>
    turnMoved(turn, 'a', 1, at(...from), at(...to), 100, arrowKey)

  it('counts diagonals as 1, and every dragged move, there and back', () => {
    let t = step(null, [0, 0], [3, 2], false)
    expect(t.squares).toBe(3)
    expect(t.start).toEqual(at(0, 0))
    t = step(t, [3, 2], [0, 0], false)
    expect(t.squares).toBe(6)
  })

  it('takes an arrow-key step back off again', () => {
    let t = step(null, [0, 0], [1, 0], true)
    t = step(t, [1, 0], [2, 0], true)
    expect(t.squares).toBe(2)
    t = step(t, [2, 0], [1, 0], true)
    expect(t.squares).toBe(1)
    t = step(t, [1, 0], [0, 0], true)
    expect(t.squares).toBe(0)
    // A drag, then a step back onto where the drag began: that counts.
    t = step(t, [0, 0], [4, 0], false)
    t = step(t, [4, 0], [5, 0], true)
    t = step(t, [5, 0], [4, 0], true)
    expect(t.squares).toBe(4)
    t = step(t, [4, 0], [3, 0], true)
    expect(t.squares).toBe(5)
  })

  it('starts again on a new turn', () => {
    const t = step(null, [0, 0], [2, 0], false)
    expect(turnMoved(t, 'b', 1, at(2, 0), at(3, 0), 100, false)).toMatchObject({ ref: 'b', squares: 1, start: at(2, 0) })
    expect(turnMoved(t, 'a', 2, at(2, 0), at(3, 0), 100, false).squares).toBe(1)
  })
})
