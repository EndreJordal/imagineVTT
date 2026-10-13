import { beforeEach, describe, expect, it } from 'vitest'
import { useGm } from './store'

describe('character tokens in the store', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: { ...s.scene, characters: [], grid: { ...s.scene.grid, size: 100, offsetX: 0, offsetY: 0 } },
      selectedCharacterId: null,
    }))
  })

  it('places tokens on a square, numbered, and selects the new one', () => {
    const { addCharacter } = useGm.getState()
    addCharacter({ x: 120, y: 290 })
    addCharacter({ x: 0, y: 0 })
    const tokens = useGm.getState().scene.characters!
    expect(tokens.map((t) => t.name)).toEqual(['Character 1', 'Character 2'])
    expect(tokens[0]).toMatchObject({ x: 150, y: 250, visible: true, snap: true, size: 1 })
    expect(useGm.getState().selectedCharacterIds).toEqual([tokens[1].id])
  })

  it('turns every token together, in quarter turns that wrap', () => {
    const { turnCharacters } = useGm.getState()
    const turn = () => useGm.getState().scene.characterTurn ?? 0
    turnCharacters(1)
    expect(turn()).toBe(1)
    turnCharacters(2)
    expect(turn()).toBe(3)
    turnCharacters(1)
    expect(turn()).toBe(0)
    turnCharacters(-1)
    expect(turn()).toBe(3)
    turnCharacters(1)
  })

  it('moves a square at a time with the arrows, and onto squares when dropped', () => {
    const { addCharacter, nudgeCharacters, moveCharacters, updateCharacter } = useGm.getState()
    addCharacter({ x: 150, y: 150 })
    const id = useGm.getState().selectedCharacterIds[0]
    const at = () => useGm.getState().scene.characters!.find((t) => t.id === id)!
    nudgeCharacters([id], 1, 0, false)
    expect(at()).toMatchObject({ x: 250, y: 150 })
    moveCharacters([id], 170, 183)
    expect(at()).toMatchObject({ x: 450, y: 350 })
    updateCharacter(id, { snap: false })
    moveCharacters([id], -30, -17)
    expect(at()).toMatchObject({ x: 420, y: 333 })
    nudgeCharacters([id], 0, 1, false)
    expect(at().y).toBeCloseTo(343)
  })
})

describe('the fight linked to the scene', () => {
  const summary = () => ({
    name: 'Fight',
    round: 1,
    phase: 'act',
    activeId: 'e1',
    order: ['e1', 'e2'],
    combatants: [
      {
        id: 'e1',
        name: 'Hollis',
        type: 'Brujah',
        side: 'npc' as const,
        allegiance: 'enemy' as const,
        state: 'active',
        inactive: false,
        acted: false,
        init: 12,
        portrait: '',
        vtt: { border: 'gold', label: 'both' as const },
      },
      {
        id: 'e2',
        name: 'Jinx',
        type: 'Pander',
        side: 'npc' as const,
        allegiance: 'enemy' as const,
        state: 'active',
        inactive: false,
        acted: false,
        init: 8,
        portrait: '',
        vtt: null,
      },
    ],
  })
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: { ...s.scene, characters: [], grid: { ...s.scene.grid, size: 100, offsetX: 0, offsetY: 0 } },
      combat: { linkId: 'mine', encounter: 'Fight', summary: null, snapshot: null, showOrder: true, edge: 'bottom' },
    }))
  })

  it('takes the tracker report only for the fight of this scene', () => {
    const { receiveTrackerState } = useGm.getState()
    expect(receiveTrackerState('someone-else', summary(), { combat: 1 })).toBe(false)
    expect(useGm.getState().combat!.summary).toBeNull()
    expect(receiveTrackerState('mine', summary(), { combat: 2 })).toBe(true)
    expect(useGm.getState().combat).toMatchObject({ snapshot: { combat: 2 }, summary: { round: 1 } })
  })

  it('places a hidden token with its look, moves it when placed again, and keeps it following its combatant', () => {
    const { receiveTrackerState, placeCombatant } = useGm.getState()
    receiveTrackerState('mine', summary(), null)
    placeCombatant('e1', { x: 120, y: 290 }, 'combatant:abc')
    const token = () => useGm.getState().scene.characters!.find((t) => t.ref === 'e1')!
    expect(token()).toMatchObject({
      name: 'Hollis',
      type: 'Brujah',
      border: 'gold',
      label: 'both',
      x: 150,
      y: 250,
      visible: false,
      portrait: 'combatant:abc',
    })
    placeCombatant('e1', { x: 420, y: 330 }, null)
    expect(useGm.getState().scene.characters).toHaveLength(1)
    expect(token()).toMatchObject({ x: 450, y: 350 })
    // Renamed and killed in the tracker: the token follows.
    const dead = summary()
    dead.combatants[0] = { ...dead.combatants[0], name: 'Hollis the Ductus', state: 'dead' }
    receiveTrackerState('mine', dead, null)
    expect(token()).toMatchObject({ name: 'Hollis the Ductus', down: true })
    useGm.getState().clearCombatTokens()
    expect(useGm.getState().scene.characters).toEqual([])
  })
})

describe('several character tokens at once', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: { ...s.scene, characters: [], groups: [], grid: { ...s.scene.grid, size: 100, offsetX: 0, offsetY: 0 } },
      selectedCharacterIds: [],
    }))
  })
  const ids = () => useGm.getState().scene.characters!.map((t) => t.id)
  const at = (id: string) => {
    const t = useGm.getState().scene.characters!.find((x) => x.id === id)!
    return [t.x, t.y]
  }

  it('selects with Shift and a box, and moves, nudges and removes them together', () => {
    const g = useGm.getState()
    g.addCharacter({ x: 150, y: 150 })
    g.addCharacter({ x: 350, y: 150 })
    g.addCharacter({ x: 550, y: 150 })
    const [a, b, c] = ids()
    g.selectCharacter(a)
    g.toggleCharacterSelected(b)
    expect(useGm.getState().selectedCharacterIds).toEqual([a, b])
    g.toggleCharacterSelected(a)
    expect(useGm.getState().selectedCharacterIds).toEqual([b])
    g.selectMany([], [], [], false, [a, c])
    expect(useGm.getState().selectedCharacterIds).toEqual([a, c])
    // Dragged by one of them: all move by the same amount, onto the squares.
    g.moveCharacters([a, c], 210, 95)
    expect([at(a), at(c), at(b)]).toEqual([
      [350, 250],
      [750, 250],
      [350, 150],
    ])
    g.nudgeCharacters([a, c], 0, -1, false)
    expect([at(a), at(c)]).toEqual([
      [350, 150],
      [750, 150],
    ])
    useGm.getState().deleteSelection()
    expect(ids()).toEqual([b])
  })

  it('groups tokens, and a group is selected as one', () => {
    const g = useGm.getState()
    g.addCharacter({ x: 150, y: 150 })
    g.addCharacter({ x: 350, y: 150 })
    const [a, b] = ids()
    g.selectCharacters([a, b])
    g.groupSelection()
    const group = useGm.getState().scene.characters![0].group!
    expect(group).toBeTruthy()
    expect(useGm.getState().scene.characters!.every((t) => t.group === group)).toBe(true)
    g.selectCharacter(null)
    g.selectGroup(group)
    expect(useGm.getState().selectedCharacterIds).toEqual([a, b])
    g.ungroup(group)
    expect(useGm.getState().scene.characters!.some((t) => t.group)).toBe(false)
  })

  it('places every combatant not on the map yet, in a block around the drop, all selected', () => {
    const fighter = (id: string, size: 1 | 2 = 1) => ({
      id,
      name: id,
      type: '',
      side: 'npc' as const,
      allegiance: 'enemy' as const,
      state: 'active',
      inactive: false,
      acted: false,
      init: null,
      portrait: '',
      vtt: size === 2 ? { size: 2 as const } : null,
    })
    const combatants = ['a', 'b', 'c', 'd', 'e'].map((id) => fighter(id))
    useGm.setState({
      combat: {
        linkId: 'l',
        encounter: 'E',
        summary: { name: 'E', round: 1, phase: 'setup', activeId: null, order: [], combatants },
        snapshot: null,
        showOrder: true,
      },
    })
    const g = useGm.getState()
    g.placeCombatant('a', { x: 950, y: 950 }, null)
    g.placeCombatants(combatants.map((c) => ({ id: c.id, portrait: null })), { x: 500, y: 500 })
    const placed = useGm.getState().scene.characters!.filter((t) => t.ref !== 'a')
    // The four not placed yet: a 2 x 2 block, a square apart, round the drop.
    expect(placed.map((t) => [t.ref, t.x, t.y])).toEqual([
      ['b', 450, 450],
      ['c', 550, 450],
      ['d', 450, 550],
      ['e', 550, 550],
    ])
    expect(placed.every((t) => !t.visible)).toBe(true)
    expect(useGm.getState().selectedCharacterIds).toEqual(placed.map((t) => t.id))
  })
})
