import { beforeEach, describe, expect, it } from 'vitest'
import { createLight } from '../shared/lights'
import { extractLevel } from '../shared/levels'
import { allLevels, levelImage } from './store'
import { tableState, useGm } from './store'
import { SELECT } from './tools'


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

describe('locking the map in place', () => {
  it('keeps a locked map where it is and how big it is, until it is unlocked', async () => {
    const { setMap, setMapLocked, setMapPosition, setMapScale, fitMapToView } = useGm.getState()
    setMap(new Blob(['x']), { width: 800, height: 600 })
    const at = () => {
      const m = useGm.getState().scene.map!
      return [m.x, m.y, m.width]
    }
    const start = at()
    setMapLocked(true)
    setMapPosition({ x: start[0] + 300, y: start[1] + 300 })
    fitMapToView('x')
    setMapScale(2)
    expect(at()).toEqual(start)
    setMapLocked(false)
    setMapPosition({ x: start[0] + 300, y: start[1] + 300 })
    expect(at()).toEqual([start[0] + 300, start[1] + 300, start[2]])
    setMap(null, null)
  })
})

describe('the selection', () => {
  it('selecting one thing puts everything else away; adding keeps several kinds together', () => {
    useGm.setState((s) => ({ scene: { ...s.scene, characters: [], lights: [], sounds: [] } }))
    const g = useGm.getState()
    g.addCharacter({ x: 150, y: 150 })
    g.addLight('torch', { x: 300, y: 300 })
    const token = useGm.getState().scene.characters![0].id
    const light = useGm.getState().scene.lights[0].id
    // Adding a light took the token out of the selection.
    expect(useGm.getState().selectedCharacterIds).toEqual([])
    g.selectCharacter(token)
    g.toggleLightSelected(light)
    expect(useGm.getState()).toMatchObject({ selectedCharacterIds: [token], selectedLightIds: [light] })
    // A sound is selected on its own.
    g.addSound('clip', 'Crow', { x: 0, y: 0 })
    expect(useGm.getState()).toMatchObject({ selectedCharacterIds: [], selectedLightIds: [], selectedObjectIds: [] })
    expect(useGm.getState().selectedSoundId).toBeTruthy()
  })
})
