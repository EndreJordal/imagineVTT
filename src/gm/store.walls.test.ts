import { beforeEach, describe, expect, it } from 'vitest'
import { useGm } from './store'
import { SELECT } from './tools'


describe('walls', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        walls: [],
        lights: [],
        map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
      },
      tool: SELECT,
      wallDraft: [],
    }))
  })

  it('draws a wall point by point, with undo, and confirms it', () => {
    const { setTool, addWallPoint, undoWallPoint, confirmWallDraft } = useGm.getState()
    setTool({ kind: 'walls' })
    addWallPoint({ x: 0, y: 0 })
    addWallPoint({ x: 0, y: 0 }) // a double click doesn't add a duplicate
    addWallPoint({ x: 100, y: 0 })
    addWallPoint({ x: 100, y: 100 })
    undoWallPoint()
    expect(useGm.getState().wallDraft).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    confirmWallDraft()
    expect(useGm.getState().scene.walls.map((w) => w.points)).toEqual([[{ x: 0, y: 0 }, { x: 100, y: 0 }]])
    expect(useGm.getState().wallDraft).toEqual([])
  })

  it('needs two points for a wall, and cancelling drops the points', () => {
    const { setTool, addWallPoint, confirmWallDraft, cancelWallDraft } = useGm.getState()
    setTool({ kind: 'walls' })
    addWallPoint({ x: 0, y: 0 })
    confirmWallDraft()
    expect(useGm.getState().scene.walls).toEqual([])
    addWallPoint({ x: 0, y: 0 })
    addWallPoint({ x: 50, y: 0 })
    cancelWallDraft()
    expect(useGm.getState().wallDraft).toEqual([])
    expect(useGm.getState().scene.walls).toEqual([])
  })

  it('moves and scales walls with the map', () => {
    const { setTool, addWallPoint, confirmWallDraft, setMapPosition, setMapScale } = useGm.getState()
    setTool({ kind: 'walls' })
    addWallPoint({ x: 100, y: 200 })
    addWallPoint({ x: 300, y: 200 })
    confirmWallDraft()
    setMapPosition({ x: 50, y: 0 })
    setMapScale(2)
    expect(useGm.getState().scene.walls[0].points).toEqual([{ x: 250, y: 400 }, { x: 650, y: 400 }])
  })

  it('box-selects lights and wall points together, adds to it, and deletes it all', () => {
    const gm = () => useGm.getState()
    gm().setTool({ kind: 'walls' })
    gm().addWallPoint({ x: 0, y: 0 })
    gm().addWallPoint({ x: 100, y: 0 })
    gm().addWallPoint({ x: 200, y: 0 })
    gm().confirmWallDraft()
    gm().setTool(SELECT)
    gm().addLight('brazier', { x: 50, y: 50 })
    gm().addLight('candle', { x: 900, y: 900 })
    const wallId = gm().scene.walls[0].id
    const [brazier, candle] = gm().scene.lights.map((l) => l.id)

    gm().selectMany([brazier], [{ wallId, index: 2 }], [], false)
    gm().selectMany([candle], [{ wallId, index: 2 }], [], true) // add; no duplicate point
    expect(gm().selectedLightIds).toEqual([brazier, candle])
    expect(gm().selectedWallPoints).toEqual([{ wallId, index: 2 }])

    gm().deleteSelection()
    expect(gm().scene.lights).toEqual([])
    expect(gm().scene.walls.map((w) => w.points.length)).toEqual([2]) // cut at the deleted end
    expect([gm().selectedLightIds, gm().selectedWallPoints]).toEqual([[], []])
  })

  it('clicking a light clears the wall point selection, and vice versa', () => {
    const gm = () => useGm.getState()
    gm().selectWallPoint({ wallId: 'w', index: 0 })
    gm().selectLight('x')
    expect(gm().selectedWallPoints).toEqual([])
    gm().selectWallPoint({ wallId: 'w', index: 0 })
    expect(gm().selectedLightIds).toEqual([])
  })

  it('closes a shape when the first point is clicked again, and treats that corner as one point', () => {
    const gm = () => useGm.getState()
    gm().setTool({ kind: 'walls' })
    for (const p of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }]) {
      gm().addWallPoint(p)
    }
    // Finished without Enter: one closed wall, nothing left in the draft.
    expect(gm().wallDraft).toEqual([])
    const [room] = gm().scene.walls
    expect(room.points).toHaveLength(5)

    // Clicking the start corner selects both its points.
    gm().selectWallPoint({ wallId: room.id, index: 0 })
    expect(gm().selectedWallPoints).toEqual([
      { wallId: room.id, index: 0 },
      { wallId: room.id, index: 4 },
    ])
    // Deleting the corner opens the room there: one wall from (100,0) round to (0,100).
    gm().deleteWallPoints([{ wallId: room.id, index: 4 }])
    expect(gm().scene.walls.map((w) => w.points)).toEqual([
      [{ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    ])
  })
})

describe('doors', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        walls: [{ id: 'r', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }] }],
        map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
      },
      tool: SELECT,
      doorDraft: null,
      selectedWallPoints: [],
    }))
  })
  const gm = () => useGm.getState()
  const doors = () => gm().scene.walls.filter((w) => w.door)

  it('makes a door from two clicks on the same wall, and toggles it', () => {
    gm().setTool({ kind: 'doors' })
    gm().placeDoorPoint({ x: 100, y: 0 })
    expect(gm().doorDraft).toEqual({ x: 100, y: 0 })
    gm().placeDoorPoint({ x: 200, y: 0 })
    expect(doors().map((d) => [d.points, d.door])).toEqual([[[{ x: 100, y: 0 }, { x: 200, y: 0 }], { open: false }]])
    expect(gm().doorDraft).toBeNull()
    gm().toggleDoor(doors()[0].id)
    expect(doors()[0].door).toEqual({ open: true })
  })

  it('starts over when the second click is on another stretch of wall', () => {
    gm().setTool({ kind: 'doors' })
    gm().placeDoorPoint({ x: 100, y: 0 })
    gm().placeDoorPoint({ x: 400, y: 100 })
    expect(doors()).toEqual([])
    expect(gm().doorDraft).toEqual({ x: 400, y: 100 })
  })

  it('converts two selected neighbouring wall points into a door', () => {
    gm().convertToDoor([{ wallId: 'r', index: 1 }, { wallId: 'r', index: 2 }])
    expect(doors().map((d) => d.points)).toEqual([[{ x: 400, y: 0 }, { x: 400, y: 300 }]])
  })
})

describe('doors keep their own settings', () => {
  it('keeps its own reveal and sounds when a door opens, and its sounds when the reveal changes', () => {
    const door = { id: 'door', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], door: { open: false } }
    useGm.setState((s) => ({ scene: { ...s.scene, walls: [door] } }))
    const { setDoorOwnReveal, setDoorOwnSounds, toggleDoor } = useGm.getState()
    setDoorOwnSounds('door', { open: 'creak', close: null, volume: 0.5 })
    setDoorOwnReveal('door', { effect: 'fade', duration: 2 })
    toggleDoor('door')
    const d = () => useGm.getState().scene.walls.find((w) => w.id === 'door')!.door!
    expect(d()).toEqual({ open: true, reveal: { effect: 'fade', duration: 2 }, sounds: { open: 'creak', close: null, volume: 0.5 } })
    setDoorOwnReveal('door', undefined)
    expect(d().sounds).toBeDefined()
    expect(d().reveal).toBeUndefined()
    useGm.setState((s) => ({ scene: { ...s.scene, walls: [] } }))
  })
})
