import { beforeEach, describe, expect, it } from 'vitest'
import { gmDarkness, useGm } from './store'

const lights = () => useGm.getState().scene.lights
const byKind = (kind: string) => lights().find((l) => l.kind === kind)!

describe('lights in the store', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        lights: [],
        view: { x: 0, y: 0 },
        map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
      },
      selectedLightIds: [],
    }))
  })

  it('adds hand-held lights unlit and fixed lights lit, and selects the new light', () => {
    useGm.getState().addLight('torch', { x: 10, y: 20 })
    expect(byKind('torch').on).toBe(false)
    expect(useGm.getState().selectedLightIds).toEqual([byKind('torch').id])
    useGm.getState().addLight('brazier', { x: 0, y: 0 })
    expect(byKind('brazier').on).toBe(true)
  })

  it('moves lights that travel with the table view, and only those', () => {
    const { addLight, updateLight, setView } = useGm.getState()
    addLight('lantern', { x: 100, y: 100 })
    addLight('candle', { x: 300, y: 300 })
    updateLight(byKind('lantern').id, { followView: true })

    setView({ x: 50, y: -20 })
    expect([byKind('lantern').x, byKind('lantern').y]).toEqual([150, 80])
    expect([byKind('candle').x, byKind('candle').y]).toEqual([300, 300])

    // Dragging it by hand still works, and it keeps following from there.
    updateLight(byKind('lantern').id, { x: 0, y: 0 })
    setView({ x: 60, y: -20 })
    expect([byKind('lantern').x, byKind('lantern').y]).toEqual([10, 0])
  })

  it('carries map lights along when the map moves or scales, but not party lights', () => {
    const { addLight, updateLight, setMapPosition, setMapScale } = useGm.getState()
    addLight('fixture', { x: 200, y: 300 })
    addLight('lantern', { x: 500, y: 500 })
    updateLight(byKind('lantern').id, { followView: true })

    setMapPosition({ x: 100, y: -50 })
    expect([byKind('fixture').x, byKind('fixture').y]).toEqual([300, 250])
    expect([byKind('lantern').x, byKind('lantern').y]).toEqual([500, 500])

    // Doubling the map's size keeps the fixture on the same spot of the image.
    setMapScale(2)
    expect([byKind('fixture').x, byKind('fixture').y]).toEqual([500, 550])
    expect([byKind('lantern').x, byKind('lantern').y]).toEqual([500, 500])
  })

  it('selects several lights with toggling, and edits, moves and removes them together', () => {
    const { addLight, toggleLightSelected, selectLight, updateLights, moveLights, removeLights } = useGm.getState()
    addLight('torch', { x: 0, y: 0 })
    addLight('flashlight', { x: 100, y: 0 })
    addLight('brazier', { x: 500, y: 500 })
    const [torch, flash, brazier] = lights().map((l) => l.id)
    const selected = () => useGm.getState().selectedLightIds

    selectLight(torch)
    toggleLightSelected(flash)
    expect(selected()).toEqual([torch, flash])
    toggleLightSelected(torch)
    expect(selected()).toEqual([flash])
    toggleLightSelected(torch)

    // A shared change, and one that only applies to cone lights.
    updateLights(selected(), { radius: 5 })
    updateLights(selected(), (l) => (l.kind === 'flashlight' ? { cone: 80 } : {}))
    expect([byKind('torch').radius, byKind('flashlight').radius, byKind('brazier').radius]).toEqual([5, 5, 6])
    expect([byKind('torch').cone, byKind('flashlight').cone]).toEqual([50, 80])

    moveLights(selected(), 10, -10)
    expect([byKind('torch').x, byKind('flashlight').x, byKind('brazier').x]).toEqual([10, 110, 500])

    removeLights(selected())
    expect(lights().map((l) => l.id)).toEqual([brazier])
    expect(selected()).toEqual([])
  })
})

describe('gmDarkness', () => {
  const scene = (darkness: number) => ({ ...useGm.getState().scene, darkness })

  it('spares the GM a fraction of the night, following the table', () => {
    expect(gmDarkness({ scene: scene(1), gmVision: 0.5, peeking: false })).toBe(0.5)
    expect(gmDarkness({ scene: scene(0.4), gmVision: 0.5, peeking: false })).toBeCloseTo(0.2)
    expect(gmDarkness({ scene: scene(1), gmVision: 1, peeking: false })).toBe(0)
    expect(gmDarkness({ scene: scene(1), gmVision: 0, peeking: false })).toBe(1)
  })

  it("shows exactly the players' darkness while peeking", () => {
    expect(gmDarkness({ scene: scene(0.9), gmVision: 1, peeking: true })).toBe(0.9)
  })
})

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
        fog: { enabled: false },
        walls: [],
      },
      fogMemory: null,
      fogVersion: 0,
    }))
  })

  it('reveals around vision tokens (lit or not), and not around fixed lights', () => {
    const { addLight, setFogEnabled, updateLight } = useGm.getState()
    addLight('torch', { x: 1000, y: 1000 }) // unlit, but sees
    addLight('vision', { x: 4000, y: 1000 })
    addLight('fixture', { x: 1000, y: 4000 }) // lit, no vision
    updateLight(lights()[1].id, { vision: true, visionRange: 5 })

    setFogEnabled(true)
    expect(seen(1000, 1000)).toBe(255)
    expect(seen(1000 + 1500, 1000)).toBe(255) // 15 squares: inside the torch's 20
    expect(seen(4000 + 700, 1000)).toBe(0) // beyond the vision token's 5
    expect(seen(1000, 4000)).toBe(0)
  })

  it('remembers where vision tokens have been, until reset', () => {
    const { addLight, setFogEnabled, updateLight, stampFog, resetFog } = useGm.getState()
    addLight('vision', { x: 500, y: 500 })
    updateLight(lights()[0].id, { vision: true, visionRange: 3 })
    setFogEnabled(true)
    updateLight(lights()[0].id, { x: 3000, y: 3000 })
    stampFog() // the GM's sync does this on every scene change
    expect(seen(500, 500)).toBe(255) // still remembered
    expect(seen(3000, 3000)).toBe(255)

    resetFog()
    expect(seen(500, 500)).toBe(0) // forgotten
    expect(seen(3000, 3000)).toBe(255) // still in sight now
  })
})

describe('walls', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        walls: [],
        lights: [],
        map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
      },
      buildingWalls: false,
      wallDraft: [],
    }))
  })

  it('draws a wall point by point, with undo, and confirms it', () => {
    const { setBuildingWalls, addWallPoint, undoWallPoint, confirmWallDraft } = useGm.getState()
    setBuildingWalls(true)
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
    const { setBuildingWalls, addWallPoint, confirmWallDraft, cancelWallDraft } = useGm.getState()
    setBuildingWalls(true)
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
    const { setBuildingWalls, addWallPoint, confirmWallDraft, setMapPosition, setMapScale } = useGm.getState()
    setBuildingWalls(true)
    addWallPoint({ x: 100, y: 200 })
    addWallPoint({ x: 300, y: 200 })
    confirmWallDraft()
    setMapPosition({ x: 50, y: 0 })
    setMapScale(2)
    expect(useGm.getState().scene.walls[0].points).toEqual([{ x: 250, y: 400 }, { x: 650, y: 400 }])
  })

  it('box-selects lights and wall points together, adds to it, and deletes it all', () => {
    const gm = () => useGm.getState()
    gm().setBuildingWalls(true)
    gm().addWallPoint({ x: 0, y: 0 })
    gm().addWallPoint({ x: 100, y: 0 })
    gm().addWallPoint({ x: 200, y: 0 })
    gm().confirmWallDraft()
    gm().setBuildingWalls(false)
    gm().addLight('brazier', { x: 50, y: 50 })
    gm().addLight('candle', { x: 900, y: 900 })
    const wallId = gm().scene.walls[0].id
    const [brazier, candle] = gm().scene.lights.map((l) => l.id)

    gm().selectMany([brazier], [{ wallId, index: 2 }], false)
    gm().selectMany([candle], [{ wallId, index: 2 }], true) // add; no duplicate point
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
    gm().setBuildingWalls(true)
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

describe('opening a scene file', () => {
  it('replaces the scene, orientation, map, fog and camera, and resets the tools', () => {
    const gm = () => useGm.getState()
    gm().selectLight('something')
    gm().setBuildingWalls(true)
    const before = gm().cameraVersion
    const image = new Blob(['img'], { type: 'image/png' })
    const old = { ...gm().scene, darkness: 0.3, lights: [], walls: [], fog: { enabled: true } } as const
    // An "old" file: no grid style, vision fields or walls, which loading fills in.
    const saved = JSON.parse(JSON.stringify({ ...old, grid: { size: 70, offsetX: 0, offsetY: 0, visible: true } }))
    delete saved.walls
    gm().loadScene(
      {
        scene: saved,
        orientation: 180,
        camera: { x: 1, y: 2, zoom: 0.5 },
        mapImage: image,
        fogMemory: { cols: 1, rows: 1, data: new Uint8Array([255]) },
      },
      'Goblin cave',
    )
    expect(gm().scene.grid).toMatchObject({ size: 70, color: '#ffffff', opacity: 0.35 })
    expect(gm().scene.walls).toEqual([])
    expect(gm().display.orientation).toBe(180)
    expect(gm().mapImage).toBe(image)
    expect(gm().fogMemory?.data[0]).toBe(255)
    expect(gm().gmCamera).toEqual({ x: 1, y: 2, zoom: 0.5 })
    expect(gm().cameraVersion).toBe(before + 1)
    expect([gm().sceneName, gm().unsaved]).toEqual(['Goblin cave', false])
    expect([gm().selectedLightIds, gm().buildingWalls]).toEqual([[], false])
  })
})

