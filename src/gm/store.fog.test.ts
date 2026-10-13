import { beforeEach, describe, expect, it } from 'vitest'
import { activeAreas, decodeHidden } from '../shared/hidden'
import { migrateScene } from '../shared/migrate'
import { useGm } from './store'

const lights = () => useGm.getState().scene.lights

describe('fog of war', () => {
  const seen = (x: number, y: number) => {
    const { fogMemory: m, scene } = useGm.getState()
    const b = scene.map!
    const cx = Math.floor(((x - b.x) / b.width) * m!.cols)
    const cy = Math.floor(((y - b.y) / b.height) * m!.rows)
    return m!.data[cy * m!.cols + cx]
  }

  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        lights: [],
        grid: { ...s.scene.grid, size: 100 },
        map: { x: 0, y: 0, width: 5000, height: 5000, naturalWidth: 5000, naturalHeight: 5000 },
        fog: { mode: 'off', safety: true },
        walls: [],
      },
      fogMemory: null,
      fogVersion: 0,
    }))
  })

  it('reveals around vision tokens (lit or not), and not around fixed lights', () => {
    const { addLight, setFogMode, updateLight } = useGm.getState()
    addLight('torch', { x: 1000, y: 1000 }) // unlit, but sees
    addLight('vision', { x: 4000, y: 1000 })
    addLight('fixture', { x: 1000, y: 4000 }) // lit, no vision
    updateLight(lights()[1].id, { vision: true, visionRange: 5 })

    setFogMode('full')
    expect(seen(1000, 1000)).toBe(255)
    expect(seen(1000 + 1500, 1000)).toBe(255) // 15 squares: inside the torch's 20
    expect(seen(4000 + 700, 1000)).toBe(0) // beyond the vision token's 5
    expect(seen(1000, 4000)).toBe(0)
  })

  it('remembers where vision tokens have been, until reset', () => {
    const { addLight, setFogMode, updateLight, stampFog, resetFog } = useGm.getState()
    addLight('vision', { x: 500, y: 500 })
    updateLight(lights()[0].id, { vision: true, visionRange: 3 })
    setFogMode('full')
    updateLight(lights()[0].id, { x: 3000, y: 3000 })
    stampFog() // the GM's sync does this on every scene change
    expect(seen(500, 500)).toBe(255) // still remembered
    expect(seen(3000, 3000)).toBe(255)

    resetFog()
    expect(seen(500, 500)).toBe(0) // forgotten
    expect(seen(3000, 3000)).toBe(255) // still in sight now
  })
})

describe('hidden areas', () => {
  const room = [
    { x: 400, y: 400 },
    { x: 600, y: 400 },
    { x: 600, y: 600 },
    { x: 400, y: 600 },
    { x: 400, y: 400 },
  ]
  const areas = () => useGm.getState().scene.hiddenAreas ?? []
  beforeEach(() => {
    useGm.setState((s) => ({
      levelId: s.tableLevelId,
      scene: {
        ...s.scene,
        grid: { ...s.scene.grid, size: 100, offsetX: 0, offsetY: 0 },
        map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
        walls: [{ id: 'room', points: room }],
        lights: [],
        hiddenAreas: [],
        fog: { mode: 'full', safety: true },
      },
      fogMemory: null,
      selectedHiddenId: null,
    }))
  })

  it('fills an enclosed room as an area, refuses an open space, and selects an area clicked again', () => {
    const { hideFill } = useGm.getState()
    expect(hideFill({ x: 100, y: 100 })).toBe('open')
    expect(areas()).toHaveLength(0)
    expect(hideFill({ x: 500, y: 500 })).toBe('filled')
    expect(areas()).toHaveLength(1)
    expect(areas()[0]).toMatchObject({ softness: 0.3, revealWithVision: true })
    expect(hideFill({ x: 500, y: 500 })).toBe('selected')
    expect(useGm.getState().selectedHiddenId).toBe(areas()[0].id)
    expect(areas()).toHaveLength(1)
  })

  it('makes an area per brush stroke, adds to the area a stroke starts on, and erases', () => {
    const { hidePaint } = useGm.getState()
    hidePaint({ x: 100, y: 100 }, { x: 300, y: 100 }, false, 'one')
    hidePaint({ x: 100, y: 800 }, { x: 300, y: 800 }, false, 'two')
    expect(areas()).toHaveLength(2)
    hidePaint({ x: 200, y: 100 }, { x: 200, y: 300 }, false, 'three') // starts on the first
    expect(areas()).toHaveLength(2)
    hidePaint({ x: 100, y: 800 }, { x: 300, y: 800 }, true, 'four')
    expect(areas()).toHaveLength(1)
  })

  it('removes an area, and sets one up', () => {
    const { hideFill, updateHidden, removeHidden } = useGm.getState()
    hideFill({ x: 500, y: 500 })
    const id = areas()[0].id
    updateHidden(id, { softness: 1, revealWithVision: false })
    expect(areas()[0]).toMatchObject({ softness: 1, revealWithVision: false })
    removeHidden(id)
    expect(areas()).toHaveLength(0)
  })

  it('reveals an area when a vision token walks into it, unless set not to', () => {
    const { hideFill, addLight, updateLight, revealEntered, updateHidden } = useGm.getState()
    hideFill({ x: 500, y: 500 })
    addLight('vision', { x: 100, y: 100 })
    const id = useGm.getState().scene.lights.at(-1)!.id
    updateLight(id, { vision: true }) // vision tokens are placed not seeing yet

    updateHidden(areas()[0].id, { revealWithVision: false })
    let before = useGm.getState().scene.lights
    updateLight(id, { x: 500, y: 500 })
    revealEntered(before)
    expect(areas()).toHaveLength(1)

    updateHidden(areas()[0].id, { revealWithVision: true })
    updateLight(id, { x: 100, y: 100 })
    before = useGm.getState().scene.lights
    updateLight(id, { x: 500, y: 500 })
    revealEntered(before)
    const [walkedInto] = areas()
    expect(decodeHidden(walkedInto.cells).some((v) => v)).toBe(false) // all uncovered, kept for Reset

    // Reset: hidden again as drawn. The token is already inside: moving about doesn't reveal it.
    useGm.getState().resetHidden(walkedInto.id)
    expect(areas()[0].cells).toBe(walkedInto.shape)
    before = useGm.getState().scene.lights
    updateLight(id, { x: 520, y: 520 })
    revealEntered(before)
    expect(decodeHidden(areas()[0].cells).some((v) => v)).toBe(true)
  })

  it("doesn't remember what's under a hidden area as explored, but sees past it", () => {
    useGm.setState((s) => ({ scene: { ...s.scene, walls: [] } }))
    const { hidePaint, addLight, updateLight, stampFog } = useGm.getState()
    hidePaint({ x: 500, y: 500 }, { x: 500, y: 500 }, false, 'patch') // one square across
    addLight('vision', { x: 300, y: 500 })
    updateLight(useGm.getState().scene.lights.at(-1)!.id, { vision: true, visionRange: 5 })
    stampFog()
    const memory = useGm.getState().fogMemory!
    const at = (x: number, y: number) =>
      memory.data[Math.floor((y / 1000) * memory.rows) * memory.cols + Math.floor((x / 1000) * memory.cols)]
    expect(at(500, 500)).toBe(0)
    expect(at(300, 500)).toBeGreaterThan(0)
    expect(at(700, 500)).toBeGreaterThan(0) // beyond the hidden patch
  })

  it('turns areas with the map', () => {
    const { hideFill, turnMap } = useGm.getState()
    hideFill({ x: 500, y: 500 })
    const before = areas()[0].cells
    turnMap(1)
    expect(areas()[0].cells).not.toBe(before)
    expect(areas()).toHaveLength(1)
  })

  it('reads hidden areas saved as one mask', () => {
    const legacy = {
      ...useGm.getState().scene,
      hiddenAreas: undefined,
      hidden: { cols: 4, rows: 1, runs: [0, 1, 2, 1] },
      hiddenSoftness: 0.8,
    }
    const scene = migrateScene(legacy)
    expect(scene.hiddenAreas).toHaveLength(2)
    expect(scene.hiddenAreas![0].softness).toBe(0.8)
    expect('hidden' in scene).toBe(false)
  })
})

describe('visibility', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      levelId: s.tableLevelId,
      scene: {
        ...s.scene,
        map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
        grid: { ...s.scene.grid, size: 100 },
        walls: [],
        lights: [],
        hiddenAreas: [],
        hiddenEnabled: true,
        objects: [],
      },
      fogMemory: null,
    }))
  })

  it('remembers explored areas only under full fog of war', () => {
    const { addLight, updateLight, setFogMode } = useGm.getState()
    addLight('vision', { x: 500, y: 500 })
    updateLight(useGm.getState().scene.lights[0].id, { vision: true })
    setFogMode('dim')
    expect(useGm.getState().fogMemory).toBeNull()
    setFogMode('full')
    expect(useGm.getState().fogMemory?.data.some((v) => v > 0)).toBe(true)
  })

  it('switches hidden areas off, all or one, without removing them', () => {
    const { hidePaint, setHiddenEnabled, updateHidden } = useGm.getState()
    hidePaint({ x: 100, y: 100 }, { x: 100, y: 100 }, false, 'a')
    hidePaint({ x: 800, y: 800 }, { x: 800, y: 800 }, false, 'b')
    const [a] = useGm.getState().scene.hiddenAreas!
    updateHidden(a.id, { active: false })
    expect(activeAreas(useGm.getState().scene)).toHaveLength(1)
    setHiddenEnabled(false)
    expect(activeAreas(useGm.getState().scene)).toHaveLength(0)
    expect(useGm.getState().scene.hiddenAreas).toHaveLength(2)
  })

  it('notices objects shown once seen, only where vision reaches, and forgets them on reset', () => {
    const { addLight, updateLight, setFogMode, addObject, noticeObjects, resetFog } = useGm.getState()
    const object = { asset: 'a', name: 'Chest', width: 50, height: 50, rotation: 0, visibility: 'seen' as const }
    addObject({ ...object, x: 300, y: 500 })
    addObject({ ...object, x: 950, y: 950 })
    addLight('vision', { x: 200, y: 500 })
    updateLight(useGm.getState().scene.lights[0].id, { vision: true, visionRange: 3 })
    setFogMode('dim')
    noticeObjects()
    expect(useGm.getState().scene.objects.map((o) => !!o.seen)).toEqual([true, false])
    setFogMode('full')
    useGm.getState().updateLight(useGm.getState().scene.lights[0].id, { x: 900, y: 900 })
    resetFog() // forgets the first; the token sees the second now
    expect(useGm.getState().scene.objects.map((o) => !!o.seen)).toEqual([false, true])
  })

  it('copies an object with its settings; a copy shown once seen is unseen', () => {
    const { addObject, copyObject } = useGm.getState()
    addObject({ asset: 'a', name: 'Rock', x: 100, y: 100, width: 60, height: 40, rotation: 1, visibility: 'seen' })
    const rock = useGm.getState().scene.objects[0]
    useGm.getState().updateObject(rock.id, { seen: true })
    copyObject(rock.id, { x: 300, y: 200 })
    const [, copy] = useGm.getState().scene.objects
    expect(copy).toMatchObject({ x: 300, y: 200, width: 60, height: 40, rotation: 1, visibility: 'seen', seen: false })
    expect(copy.id).not.toBe(rock.id)
    expect(useGm.getState().selectedObjectIds).toEqual([copy.id])
  })

  it('selects objects as a group: box, shift-toggle, moving and changing them together', () => {
    const { addObject, selectMany, toggleObjectSelected, moveObjects, updateObjects } = useGm.getState()
    for (const x of [100, 200, 300]) addObject({ asset: 'a', name: 'Crate', x, y: 100, width: 50, height: 50, rotation: 0 })
    const [a, b, c] = useGm.getState().scene.objects.map((o) => o.id)
    selectMany([], [], [a, b], false)
    toggleObjectSelected(c)
    toggleObjectSelected(a)
    expect(useGm.getState().selectedObjectIds).toEqual([b, c])
    moveObjects([b, c], 10, 5)
    updateObjects([b, c], { visibility: 'hidden' })
    const objs = useGm.getState().scene.objects
    expect(objs.map((o) => [o.x, o.y])).toEqual([[100, 100], [210, 105], [310, 105]])
    expect(objs.map((o) => o.visibility)).toEqual([undefined, 'hidden', 'hidden'])
  })

  it('reads scenes saved with fog of war on or off', () => {
    const legacy = (enabled: boolean) => ({ ...useGm.getState().scene, fog: { enabled, safety: true } }) as never
    expect(migrateScene(legacy(true)).fog.mode).toBe('full')
    expect(migrateScene(legacy(false)).fog.mode).toBe('off')
  })
})

describe('seeing into hidden areas', () => {
  // A room 400..600 with a door in its left wall (x = 400, y 450..550).
  const walls = [
    { id: 'top', points: [{ x: 400, y: 450 }, { x: 400, y: 400 }, { x: 600, y: 400 }, { x: 600, y: 600 }, { x: 400, y: 600 }, { x: 400, y: 550 }] },
    { id: 'door', points: [{ x: 400, y: 550 }, { x: 400, y: 450 }], door: { open: false } },
  ]
  beforeEach(() => {
    useGm.setState((s) => ({
      levelId: s.tableLevelId,
      scene: {
        ...s.scene,
        map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
        grid: { ...s.scene.grid, size: 100 },
        walls,
        lights: [],
        hiddenAreas: [],
        hiddenEnabled: true,
        objects: [],
      },
    }))
  })

  const hiddenCells = () =>
    (useGm.getState().scene.hiddenAreas ?? []).reduce((n, a) => n + decodeHidden(a.cells).reduce((m, v) => m + v, 0), 0)

  it('uncovers what vision sees through an open door, not the rest', () => {
    const { hideFill, addLight, updateLight, revealSeen, toggleDoor } = useGm.getState()
    expect(hideFill({ x: 500, y: 500 })).toBe('filled')
    const all = hiddenCells()
    // Looking at the room from the left, a little off the door's line.
    addLight('vision', { x: 250, y: 420 })
    updateLight(useGm.getState().scene.lights[0].id, { vision: true, visionRange: 6 })
    revealSeen()
    expect(hiddenCells()).toBeGreaterThan(all * 0.95) // the door's shut: the wall's face at most
    toggleDoor('door')
    revealSeen()
    const left = hiddenCells()
    expect(left).toBeLessThan(all * 0.9) // the view through the door is uncovered...
    expect(left).toBeGreaterThan(all * 0.2) // ...not the corner it can't see
    // Reset: all of it hidden again.
    useGm.getState().resetHidden(useGm.getState().scene.hiddenAreas![0].id)
    expect(hiddenCells()).toBe(all)
  })
})
