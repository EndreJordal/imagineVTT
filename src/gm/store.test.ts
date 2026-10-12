import { beforeEach, describe, expect, it } from 'vitest'
import { createLight } from '../shared/lights'
import { extractLevel } from '../shared/levels'
import { allLevels, levelImage } from './store'
import { activeAreas, decodeHidden } from '../shared/hidden'
import { migrateScene } from '../shared/migrate'
import { gmDarkness, tableState, useGm } from './store'
import { SELECT } from './tools'

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

describe('vision safety', () => {
  const gm = () => useGm.getState()
  // A wall along x = 300; the view is 400 wide, centred on (200, 200) (see tableScreen).
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        walls: [{ id: 'w', points: [{ x: 300, y: -1000 }, { x: 300, y: 1000 }] }],
        lights: [
          { ...createLight('torch', 290, 200, 'eye'), id: 'eye', vision: true, followView: true },
          { ...createLight('fixture', 100, 100, 'lamp'), id: 'lamp' },
        ],
        view: { x: 200, y: 200 },
        fog: { mode: 'full', safety: true },
      },
      tableScreen: { width: 400, height: 400 },
      display: { ...s.display, pxPerMm: 1, orientation: 0 },
      notice: null,
    }))
    useGm.setState((s) => ({ scene: { ...s.scene, squareMm: s.scene.grid.size } })) // 1 table px = 1 unit
  })
  const eye = () => gm().scene.lights.find((l) => l.id === 'eye')!

  it('drops a vision token dragged through a wall, with a notice', () => {
    expect(gm().moveLights(['eye', 'lamp'], 100, 0, true)).toBe(false)
    expect(eye().x).toBe(290)
    expect(gm().notice?.text).toMatch(/VISION SAFETY/)
    expect(gm().moveLights(['eye'], 5, 0, true)).toBe(true) // short of the wall
    expect(gm().moveLights(['lamp'], 500, 0, true)).toBe(true) // not a vision token
  })

  it('lets it through with safety off, or with Alt (not safe)', () => {
    expect(gm().moveLights(['eye'], 100, 0, false)).toBe(true)
    gm().moveLights(['eye'], -100, 0)
    gm().setVisionSafety(false)
    expect(gm().moveLights(['eye'], 100, 0, true)).toBe(true)
  })

  it('holds a travelling vision token at the wall until it would leave the view', () => {
    // The view moves 40 right: the token would cross x = 300, so it stays (inside the view).
    expect(gm().setView({ x: 240, y: 200 }, true)).toBe(true)
    expect(gm().scene.view.x).toBe(240)
    expect(eye().x).toBe(290)
    // Moving diagonally, it slides along the wall.
    expect(gm().setView({ x: 280, y: 230 }, true)).toBe(true)
    expect([eye().x, eye().y]).toEqual([290, 230])
    // Far enough that the token would be left outside the view: refused.
    expect(gm().setView({ x: 500, y: 230 }, true)).toBe(false)
    expect(gm().scene.view.x).toBe(280)
    expect(gm().notice?.text).toMatch(/PVB was dropped/)
  })
})

describe('objects', () => {
  const gm = () => useGm.getState()
  const map = { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 }
  beforeEach(() => {
    useGm.setState((s) => ({ scene: { ...s.scene, map, objects: [] }, selectedObjectIds: [], selectedLightIds: [] }))
  })
  const place = (name: string) =>
    gm().addObject({ asset: `A/${name}`, name, x: 100, y: 200, width: 50, height: 25, rotation: 0 })

  it('places, selects, updates, reorders and removes objects', () => {
    place('a')
    place('b')
    const [a, b] = gm().scene.objects
    expect(gm().selectedObjectIds).toEqual([b.id])
    gm().updateObject(a.id, { x: 300, rotation: 1 })
    expect(gm().scene.objects[0]).toMatchObject({ x: 300, y: 200, rotation: 1 })
    gm().reorderObject(a.id, 'front')
    expect(gm().scene.objects.map((o) => o.name)).toEqual(['b', 'a'])
    gm().selectObject(a.id)
    gm().deleteSelection()
    expect(gm().scene.objects.map((o) => o.name)).toEqual(['b'])
    expect(gm().selectedObjectIds).toEqual([])
  })

  it('selecting a light (or nothing) drops the object selection', () => {
    place('a')
    gm().selectLight(null)
    expect(gm().selectedObjectIds).toEqual([])
  })

  it('carries objects with the map when it moves or scales', () => {
    place('a')
    gm().setMapPosition({ x: 100, y: 0 })
    expect(gm().scene.objects[0]).toMatchObject({ x: 200, y: 200, width: 50 })
    gm().setMapScale(2)
    expect(gm().scene.objects[0]).toMatchObject({ x: 300, y: 400, width: 100, height: 50 })
  })
})

describe('floors', () => {
  const gm = () => useGm.getState()
  const groundMap = { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 }
  const party = { ...createLight('torch', 100, 100, 'party'), followView: true }
  const brazier = createLight('brazier', 300, 300, 'brazier')
  const groundImage = new Blob(['ground'])
  beforeEach(() => {
    gm().newScene()
    useGm.setState((s) => ({
      scene: { ...s.scene, map: groundMap, lights: [party, brazier], darkness: 0.2, view: { x: 500, y: 500 } },
      mapImage: groundImage,
    }))
  })

  it('adds a floor with its own map, walls and lights; the table keeps its floor', () => {
    const ground = gm().levelId
    gm().addLevel()
    const roof = gm().levelId
    expect(roof).not.toBe(ground)
    expect(gm().tableLevelId).toBe(ground)
    // A new floor is empty, and night/day of its own.
    expect([gm().scene.map, gm().scene.lights, gm().mapImage]).toEqual([null, [], null])
    gm().setDarkness(0.9)
    gm().addWallPoint({ x: 0, y: 0 })
    gm().addWallPoint({ x: 100, y: 0 })
    gm().confirmWallDraft()
    // Back on the ground floor: as it was.
    gm().viewLevel(ground)
    expect(gm().scene.darkness).toBe(0.2)
    expect(gm().scene.walls).toEqual([])
    expect(gm().mapImage).toBe(groundImage)
    expect(gm().scene.lights.map((l) => l.id)).toEqual(['party', 'brazier'])
    const roofLevel = allLevels(gm()).find((l) => l.id === roof)!
    expect([roofLevel.darkness, roofLevel.walls.length]).toEqual([0.9, 1])
  })

  it('shows a floor on the table, and the party goes along', () => {
    const ground = gm().levelId
    gm().addLevel()
    const roof = gm().levelId
    // While preparing the roof, the table shows the ground floor, party and all.
    expect(tableState(gm()).scene.lights.map((l) => l.id)).toEqual(['party', 'brazier'])
    // Moving the PVB still moves the party, on the floor shown.
    gm().setView({ x: 600, y: 500 })
    expect(tableState(gm()).scene.lights.find((l) => l.id === 'party')!.x).toBe(200)
    gm().showLevelOnTable()
    expect(gm().tableLevelId).toBe(roof)
    expect(gm().scene.lights.map((l) => l.id)).toEqual(['party'])
    const groundLevel = allLevels(gm()).find((l) => l.id === ground)!
    expect(groundLevel.lights.map((l) => l.id)).toEqual(['brazier'])
    expect(levelImage(gm(), ground)).toBe(groundImage)
  })

  it('renames, reorders and deletes floors (the party survives)', () => {
    const ground = gm().levelId
    gm().addLevel()
    const roof = gm().levelId
    gm().renameLevel(roof, 'Roof')
    gm().moveLevel(roof, -1)
    expect(gm().levels.map((l) => l.name)).toEqual(['Roof', 'Floor 1'])
    gm().showLevelOnTable(roof)
    gm().deleteLevel(roof)
    expect(gm().levels.map((l) => l.id)).toEqual([ground])
    expect([gm().levelId, gm().tableLevelId]).toEqual([ground, ground])
    expect(gm().scene.lights.map((l) => l.id).sort()).toEqual(['brazier', 'party'])
  })
})

describe('new scene', () => {
  it('empties the scene and forgets its name, keeping calibration', () => {
    const gm = () => useGm.getState()
    useGm.setState((s) => ({ sceneName: 'Crypt', unsaved: true, display: { ...s.display, pxPerMm: 5 } }))
    gm().addLight('torch', { x: 1, y: 2 })
    const epoch = gm().historyEpoch
    gm().newScene()
    expect(gm().scene.lights).toEqual([])
    expect(gm().mapImage).toBeNull()
    expect([gm().sceneName, gm().unsaved]).toEqual([null, false])
    expect(gm().display.pxPerMm).toBe(5)
    expect(gm().historyEpoch).toBe(epoch + 1)
  })
})

describe('opening a scene file', () => {
  it('replaces the scene, orientation, map, fog and camera, and resets the tools', () => {
    const gm = () => useGm.getState()
    gm().selectLight('something')
    gm().setTool({ kind: 'walls' })
    const before = gm().cameraVersion
    const image = new Blob(['img'], { type: 'image/png' })
    const old = { ...gm().scene, darkness: 0.3, lights: [], walls: [], fog: { enabled: true } } as const
    // An "old" file: no grid style, vision fields or walls, which loading fills in.
    const saved = JSON.parse(JSON.stringify({ ...old, grid: { size: 70, offsetX: 0, offsetY: 0, visible: true } }))
    delete saved.walls
    gm().loadScene(
      {
        scene: saved,
        levels: [extractLevel(saved, { id: 'f', name: 'Floor 1' })],
        levelId: 'f',
        tableLevelId: 'f',
        orientation: 180,
        camera: { x: 1, y: 2, zoom: 0.5 },
        mapImages: { f: image },
        fogMemories: { f: { cols: 1, rows: 1, data: new Uint8Array([255]) } },
        objectImages: {},
        soundClips: {},
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
    expect([gm().selectedLightIds, gm().tool]).toEqual([[], SELECT])
  })
})


describe('turning the map', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      levelId: s.tableLevelId,
      scene: {
        ...s.scene,
        grid: { ...s.scene.grid, size: 100, offsetX: 0, offsetY: 0 },
        map: { x: 0, y: 0, width: 400, height: 200, naturalWidth: 800, naturalHeight: 400, lockToGrid: true },
        lights: [],
        walls: [{ id: 'w', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] }],
        objects: [],
        view: { x: 300, y: 100 },
      },
      fogMemory: { cols: 2, rows: 1, data: new Uint8Array([7, 9]) },
    }))
  })

  it('turns the map with its walls, lights, view and explored areas, about a grid point', () => {
    const { addLight, turnMap } = useGm.getState()
    addLight('torch', { x: 300, y: 100 })
    turnMap(1)
    const s = useGm.getState()
    // Pivot (200, 100): the map's centre is on a grid intersection.
    expect(s.scene.map).toMatchObject({ x: 100, y: -100, width: 200, height: 400, turns: 1, lockToGrid: true })
    expect(s.scene.walls[0].points).toEqual([
      { x: 300, y: -100 },
      { x: 300, y: 300 },
    ])
    expect(s.scene.lights[0]).toMatchObject({ x: 200, y: 200, angle: Math.PI / 2 })
    expect(s.scene.view).toEqual({ x: 200, y: 200 })
    expect(s.fogMemory).toEqual({ cols: 1, rows: 2, data: new Uint8Array([7, 9]) })
  })

  it('turns back the other way', () => {
    const before = useGm.getState().scene
    const { turnMap } = useGm.getState()
    turnMap(1)
    turnMap(-1)
    const s = useGm.getState()
    expect(s.scene.map).toMatchObject({ ...before.map, turns: 0 })
    expect(s.scene.walls).toEqual(before.walls)
    expect(s.fogMemory?.data).toEqual(new Uint8Array([7, 9]))
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

describe('tools', () => {
  beforeEach(() => useGm.getState().setTool(SELECT))

  it('one at a time: picking one up puts the others, drafts and the selection away', () => {
    const gm = () => useGm.getState()
    gm().setTool({ kind: 'walls' })
    gm().addWallPoint({ x: 0, y: 0 })
    useGm.setState({ selectedLightIds: ['x'], selectedHiddenId: 'h' })
    gm().setTool({ kind: 'light', light: 'torch' })
    expect(gm()).toMatchObject({ tool: { kind: 'light', light: 'torch' }, wallDraft: [], selectedLightIds: [], selectedHiddenId: null })
    gm().setTool(SELECT)
    expect(gm().tool).toEqual(SELECT)
  })

  it('toggles with the keys, the hide tool coming back in its last mode', () => {
    const gm = () => useGm.getState()
    gm().toggleTool('doors')
    expect(gm().tool.kind).toBe('doors')
    gm().toggleTool('doors')
    expect(gm().tool).toEqual(SELECT)
    gm().setTool({ kind: 'hide', mode: 'brush' })
    gm().toggleTool('hide')
    gm().toggleTool('hide')
    expect(gm().tool).toEqual({ kind: 'hide', mode: 'brush' })
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

describe('groups and names', () => {
  beforeEach(() =>
    useGm.setState((s) => ({
      levelId: s.tableLevelId,
      scene: { ...s.scene, lights: [], objects: [], hiddenAreas: [], groups: [] },
      selectedLightIds: [],
      selectedObjectIds: [],
      selectedHiddenId: null,
    })),
  )

  it('names lights by kind, numbered, and objects after their asset, copies numbered', () => {
    const { addLight, addObject, copyObject } = useGm.getState()
    addLight('torch', { x: 0, y: 0 })
    addLight('torch', { x: 0, y: 0 })
    addLight('candle', { x: 0, y: 0 })
    expect(useGm.getState().scene.lights.map((l) => l.name)).toEqual(['Torch 1', 'Torch 2', 'Candle 1'])
    addObject({ asset: 'a', name: 'Crate', x: 0, y: 0, width: 50, height: 50, rotation: 0 })
    copyObject(useGm.getState().scene.objects[0].id, { x: 100, y: 0 })
    copyObject(useGm.getState().scene.objects[1].id, { x: 200, y: 0 })
    expect(useGm.getState().scene.objects.map((o) => o.name)).toEqual(['Crate', 'Crate 2', 'Crate 3'])
  })

  it('groups the selection, selects it as one, and ungroups', () => {
    const { addLight, addObject, groupSelection, selectGroup, selectLight, ungroup } = useGm.getState()
    addLight('torch', { x: 0, y: 0 })
    addObject({ asset: 'a', name: 'Crate', x: 0, y: 0, width: 50, height: 50, rotation: 0 })
    const light = useGm.getState().scene.lights[0].id
    const object = useGm.getState().scene.objects[0].id
    useGm.setState({ selectedLightIds: [light], selectedObjectIds: [object] })
    groupSelection()
    const group = useGm.getState().scene.groups![0]
    expect(group.name).toBe('Group 1')
    selectLight(null)
    selectGroup(group.id)
    expect([useGm.getState().selectedLightIds, useGm.getState().selectedObjectIds]).toEqual([[light], [object]])
    ungroup(group.id)
    expect(useGm.getState().scene.lights[0].group).toBeUndefined()
    expect(useGm.getState().scene.groups).toEqual([])
  })
})

describe('sounds in the store', () => {
  beforeEach(() => {
    useGm.setState((s) => ({ scene: { ...s.scene, sounds: [], globalSounds: [] }, soundClips: {} }))
  })

  it('places sounds named after the sound, numbering copies, and selects the new one', () => {
    const { addSound } = useGm.getState()
    addSound('crow', 'Crow', { x: 1, y: 2 })
    addSound('crow', 'Crow', { x: 3, y: 4 })
    const sounds = useGm.getState().scene.sounds!
    expect(sounds.map((x) => x.name)).toEqual(['Crow', 'Crow 2'])
    expect(useGm.getState().selectedSoundId).toBe(sounds[1].id)
    expect(sounds[0].loop).toBe(false)
  })

  it('moves a sound into the mixer, playing if it was a running loop', () => {
    const { addSound, updateSound, makeGlobal } = useGm.getState()
    addSound('rain', 'Rain', { x: 0, y: 0 })
    const id = useGm.getState().scene.sounds![0].id
    updateSound(id, { loop: true, volume: 0.5 })
    makeGlobal(id)
    const s = useGm.getState()
    expect(s.scene.sounds).toEqual([])
    expect(s.scene.globalSounds).toEqual([{ id, name: 'Rain', clip: 'rain', volume: 0.5, loop: true, playing: true }])
    expect(s.selectedSoundId).toBeNull()
  })
})
