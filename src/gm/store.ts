import { create } from 'zustand'
import {
  alignMapToGrid,
  boundingRect,
  carryPoint,
  clampViewZoom,
  fitMapToRect,
  mapNatural,
  mapPivot,
  sceneBounds,
  turnPoint,
  turnRect,
  followGrid,
  pointInPolygon,
  tableViewCorners,
} from '../shared/geometry'
import { createFogMemory, fitsBounds, stampVision, turnFogMemory, type FogMemory } from '../shared/fog'
import {
  createLight,
  DEFAULT_VISION_RANGE,
  LIGHT_PRESETS,
  type Light,
  type LightKind,
} from '../shared/lights'
import { carryObject, type AssetImage, type AssetImages, type MapObject } from '../shared/mapObjects'
import { applyLevel, emptyLevel, extractLevel, moveParty, type Level } from '../shared/levels'
import {
  editableMask,
  encodeHidden,
  fillHidden,
  hiddenMask,
  paintHidden,
  turnHidden,
  type FillResult,
} from '../shared/hidden'
import { load } from '../shared/persist'
import type { GmCamera, SceneFile } from '../shared/sceneFile'
import { createVisibilityTest, moveCrossesWall, visibilityPolygon, wallSegments, type Wall } from '../shared/visibility'
import {
  deleteWallPoints,
  makeDoor,
  moveWallPoints,
  selectedSegment,
  sameRef,
  sameSpot,
  withLinked,
  type WallPointRef,
} from '../shared/walls'
import type { Display, GridSettings, MapInfo, Point, Scene, Size, TableState } from '../shared/types'

export const MM_PER_INCH = 25.4

const DEFAULT_GRID_STYLE = { color: '#ffffff', opacity: 0.35 }

/** What each vision token last stamped into which memory grid (see stampFog). */
const stamped = {
  memory: null as FogMemory | null,
  viewers: new Map<string, { key: string; walls: Wall[]; hidden: Scene['hidden'] }>(),
}

/** The hiding tool's modes: fill an enclosed space, or paint and erase with a brush. */
export type HideTool = 'fill' | 'brush' | 'erase'

/** By default the GM sees half the darkness the players do. */
const DEFAULT_GM_VISION = 0.5

/** How dark the GM's own view is, given the table's darkness and the GM's vision. */
export function gmDarkness(s: Pick<GmStore, 'scene' | 'gmVision' | 'peeking'>): number {
  return s.peeking ? s.scene.darkness : s.scene.darkness * (1 - s.gmVision)
}

interface GmStore extends TableState {
  /** The map image of the floor being viewed (see levelImages for the others). */
  mapImage: Blob | null
  /**
   * The scene's floors, in order. `scene` holds the floor being viewed (levelId), so its
   * entry here is out of date while it's viewed: read floors through allLevels().
   */
  levels: Level[]
  /** The floor the GM views and edits, and the floor the table shows. */
  levelId: string
  tableLevelId: string
  /** Map images and fog memories of the floors not being viewed. */
  levelImages: Record<string, Blob | null>
  levelFog: Record<string, FogMemory | null>
  /** GM-only: the floor below shown faintly, to line maps up (stairs). */
  onionSkin: boolean
  /** View and edit another floor (the table keeps showing its floor). */
  viewLevel(id: string): void
  /** Show a floor on the table (default: the one viewed); the party goes along. */
  showLevelOnTable(id?: string): void
  /** Add an empty floor and view it. */
  addLevel(): void
  renameLevel(id: string, name: string): void
  moveLevel(id: string, by: -1 | 1): void
  deleteLevel(id: string): void
  setOnionSkin(on: boolean): void
  /** Size of the table window; the last known size while none is connected. */
  tableScreen: Size
  tableConnected: boolean
  /** Lights whose tokens are selected in the GM view (GM-only, not sent to the table). */
  selectedLightIds: string[]
  /** Selected wall points (GM-only). */
  selectedWallPoints: WallPointRef[]
  /** Selected objects (GM-only). */
  selectedObjectIds: string[]
  /** Images of the assets placed as objects, by asset key; kept with the scene. */
  objectImages: AssetImages
  /** A light kind waiting to be placed with a click on the map (GM-only). */
  placingLight: LightKind | null
  /** The hide-areas tool ("local fog"), and its mode, when it's in use. */
  hideTool: HideTool | null
  /** The mode the hide tool comes back in: the last one used. */
  hideMode: HideTool
  /** Hide brush radius, in squares. */
  hideBrush: number
  setHideTool(tool: HideTool | null): void
  /** Pick up the hide tool (in its last mode), or put it down (H). */
  toggleHideTool(): void
  setHideBrush(squares: number): void
  /** Dropper: hide the enclosed space at p (or reveal the hidden patch there). */
  hideFill(p: Point): FillResult
  /** Brush stroke from `from` to `to`, hiding or (erase) revealing. */
  hidePaint(from: Point, to: Point, erase: boolean): void
  /** Reveal every hidden area on this floor. */
  revealAll(): void
  setHiddenSoftness(squares: number): void
  /**
   * How much of the night the GM is spared, 0 (sees what the players see) to 1 (full day).
   * A GM preference: it never affects the table.
   */
  gmVision: number
  /** Temporarily show the GM exactly what the players see (while a peek key/button is held). */
  peeking: boolean
  /**
   * What the party has seen under fog of war. The grid is updated in place, so fogVersion
   * changes whenever it does (that is what subscribers watch).
   */
  fogMemory: FogMemory | null
  fogVersion: number
  /** Wall building mode (GM-only): clicks add points to the wall being drawn. */
  buildingWalls: boolean
  /** Snapping for walls, doors and placing lights: every 1, 1/2 or 1/4 square; 0 = none. */
  snap: number
  /** Points of the wall being drawn, not yet confirmed. */
  wallDraft: Point[]
  /** Door building mode (GM-only): two clicks on a wall line make a door. */
  buildingDoors: boolean
  /** The first point of the door being placed. */
  doorDraft: Point | null
  /** The GM's pan and zoom (saved with the session and in scene files). */
  gmCamera: GmCamera | null
  /** Bumped when the GM's camera should jump to gmCamera (session restore, scene open). */
  cameraVersion: number
  /** Name of the open scene file, if it came from or was saved to one. */
  sceneName: string | null
  /** Changes since the scene was last saved to or opened from a file. */
  unsaved: boolean

  setGrid(patch: Partial<GridSettings>): void
  setDisplay(patch: Partial<Display>): void
  setSquareMm(mm: number): void
  /**
   * Move the table view (and the lights travelling with it). With `safe`, vision safety
   * applies: travelling vision tokens stop at walls, and if one would end up outside the
   * view, the view doesn't move and false is returned.
   */
  setView(view: Point, safe?: boolean): boolean
  /** Zoom the table view (1: true scale, matching the minis). */
  setViewZoom(zoom: number): void
  setDarkness(darkness: number): void
  setGmVision(vision: number): void
  /** The GM panned or zoomed (doesn't move the camera; the canvas already did). */
  setGmCamera(camera: GmCamera): void
  /** Replace the scene with one from a file. */
  loadScene(file: SceneFile, name: string): void
  /** Start over with an empty scene (calibration and the table stay as they are). */
  newScene(): void
  /** Whether there's anything to undo or redo (kept up to date by history.ts). */
  history: { canUndo: boolean; canRedo: boolean }
  /** Bumped when a different scene replaces this one, so its undo history is dropped. */
  historyEpoch: number
  /** The scene was just saved under this name. */
  markSaved(name: string): void
  markUnsaved(): void
  setFogEnabled(enabled: boolean): void
  setVisionSafety(on: boolean): void
  /** A brief message over the GM's map (id changes with each one, to show it afresh). */
  notice: { text: string; id: number } | null
  notify(text: string): void
  /** Record what vision tokens see now into fog memory (when fog is on). */
  stampFog(): void
  /** Forget everything the party has seen. */
  resetFog(): void
  setBuildingWalls(on: boolean): void
  setSnap(fraction: number): void
  addWallPoint(p: Point): void
  /** Take back the last point of the wall being drawn. */
  undoWallPoint(): void
  cancelWallDraft(): void
  /** Turn the drawn points into a wall (needs at least two). */
  confirmWallDraft(): void
  clearWalls(): void
  /**
   * Walls found on the map image (in its own pixels), placed where the map is. `replace`
   * removes the existing walls and doors first.
   */
  addDetectedWalls(walls: { points: Point[]; door?: boolean }[], replace: boolean): void
  setBuildingDoors(on: boolean): void
  /** In door mode: the first click starts a door, the second (on the same wall) makes it. */
  placeDoorPoint(p: Point): void
  cancelDoorDraft(): void
  toggleDoor(id: string): void
  /** Turn the wall segment between two selected neighbouring wall points into a door. */
  convertToDoor(refs: WallPointRef[]): void
  setPeeking(peeking: boolean): void
  /** Add a light at a scene position and select it. */
  addLight(kind: LightKind, at: Point): void
  /** Start/stop placement mode: the next click on the map places this kind of light. */
  setPlacingLight(kind: LightKind | null): void
  updateLight(id: string, patch: Partial<Light>): void
  /** Change several lights; a function patch can tailor the change to each light. */
  updateLights(ids: string[], patch: Partial<Light> | ((light: Light) => Partial<Light>)): void
  /**
   * Move lights. With `safe`, vision safety applies: if a vision token would cross a wall,
   * nothing moves and false is returned.
   */
  moveLights(ids: string[], dx: number, dy: number, safe?: boolean): boolean
  removeLights(ids: string[]): void
  /** Select just this light (or nothing at all). */
  selectLight(id: string | null): void
  /** Select just this wall point (and the points linked with it). */
  selectWallPoint(ref: WallPointRef): void
  /** Add a wall point (and its linked points) to the selection, or take them out. */
  toggleWallPointSelected(ref: WallPointRef): void
  /** Box selection: these lights and wall points (added to the selection if `add`). */
  selectMany(lightIds: string[], wallPoints: WallPointRef[], add: boolean): void
  moveWallPoints(refs: WallPointRef[], dx: number, dy: number): void
  deleteWallPoints(refs: WallPointRef[]): void
  /** Delete everything selected: lights, wall points and objects. */
  deleteSelection(): void
  /** Keep an asset's image (for objects showing it). */
  setObjectImage(asset: string, image: AssetImage): void
  /** Place an object; it becomes the selection. */
  addObject(object: Omit<MapObject, 'id'>): void
  updateObject(id: string, patch: Partial<Omit<MapObject, 'id'>>): void
  removeObjects(ids: string[]): void
  /** Select just this object (or nothing at all). */
  selectObject(id: string | null): void
  /** Bring an object to the front, or send it to the back. */
  reorderObject(id: string, to: 'front' | 'back'): void
  /** Add a light to the selection, or take it out if it's already in. */
  toggleLightSelected(id: string): void
  /** Load a new map image at its natural size (null clears it). */
  setMap(image: Blob | null, size: Size | null): void
  /** Resize the map image, as a multiple of its natural size. */
  setMapScale(scale: number): void
  /**
   * Move the map image's top-left corner. Obeys axis locks. The table view stays put; the
   * grid stays put too unless the map is locked to it, in which case it moves along.
   */
  setMapPosition(position: Point): void
  /** Scale and align the map to span the table view along one axis. */
  fitMapToView(axis: 'x' | 'y'): void
  setMapLock(axis: 'x' | 'y', locked: boolean): void
  setMapLockToGrid(locked: boolean): void
  /** Scale and place the map so a grid detected in its image lands on the scene grid, and lock it there. */
  alignMapToGrid(cell: { period: number; phaseX: number; phaseY: number }): void
  /** Put the map back to an earlier placement (undo). */
  restoreMap(map: MapInfo): void
  /**
   * Turn the map a quarter turn (1 clockwise, -1 anticlockwise) with everything on it:
   * walls, lights, objects and what's been explored. It turns about a grid intersection,
   * so the grid stays matched to it.
   */
  turnMap(direction: 1 | -1): void
  setCalibrating(on: boolean): void
  setTableScreen(screen: Size): void
  setTableDisconnected(): void
}

const defaultScene: Scene = {
  map: null,
  grid: { size: 100, offsetX: 0, offsetY: 0, visible: true, ...DEFAULT_GRID_STYLE },
  squareMm: MM_PER_INCH,
  view: { x: 2000, y: 1250 },
  darkness: 0,
  lights: [],
  fog: { enabled: false, safety: true },
  walls: [],
  objects: [],
}

const FIRST_LEVEL = 'floor-1'
const firstLevel = (scene: Scene, id = FIRST_LEVEL): Level => extractLevel(scene, { id, name: 'Floor 1' })

/** Changing floor (or scene) starts the GM's tools afresh. */
const TOOLS_OFF = {
  selectedLightIds: [],
  selectedWallPoints: [],
  selectedObjectIds: [],
  placingLight: null,
  buildingWalls: false,
  wallDraft: [],
  buildingDoors: false,
  doorDraft: null,
  hideTool: null,
} satisfies Partial<GmStore>

/** All floors, up to date (the viewed one is read from the scene). */
export function allLevels(s: Pick<GmStore, 'levels' | 'levelId' | 'scene'>): Level[] {
  return s.levels.map((l) => (l.id === s.levelId ? extractLevel(s.scene, l) : l))
}

/** A floor's map image and fog memory. */
export function levelImage(s: Pick<GmStore, 'levelId' | 'mapImage' | 'levelImages'>, id: string): Blob | null {
  return id === s.levelId ? s.mapImage : (s.levelImages[id] ?? null)
}
export function levelFogMemory(s: Pick<GmStore, 'levelId' | 'fogMemory' | 'levelFog'>, id: string): FogMemory | null {
  return id === s.levelId ? s.fogMemory : (s.levelFog[id] ?? null)
}

// Calibrated on the GM's own table TV: the nominal 96 CSS px per inch square measured 137 mm
// instead of 100. Other screens differ; calibration corrects it.
const defaultDisplay: Display = { pxPerMm: (96 / MM_PER_INCH) * (100 / 137), orientation: 0 }

// Until a table window has ever connected, assume a 1080p TV.
const defaultTableScreen: Size = { width: 1920, height: 1080 }

export const useGm = create<GmStore>()((set, get) => ({
  scene: defaultScene,
  levels: [firstLevel(defaultScene)],
  levelId: FIRST_LEVEL,
  tableLevelId: FIRST_LEVEL,
  levelImages: {},
  levelFog: {},
  onionSkin: true,
  viewLevel: (id) =>
    set((s) => {
      if (id === s.levelId) return s
      const levels = allLevels(s)
      const target = levels.find((l) => l.id === id)
      if (!target) return s
      // The viewed floor's image and memory live in mapImage and fogMemory (not twice).
      const { [id]: _image, ...images } = s.levelImages
      const { [id]: _fog, ...fogs } = s.levelFog
      void _image
      void _fog
      return {
        levels,
        levelId: id,
        levelImages: { ...images, [s.levelId]: s.mapImage },
        levelFog: { ...fogs, [s.levelId]: s.fogMemory },
        scene: applyLevel(s.scene, target),
        mapImage: s.levelImages[id] ?? null,
        fogMemory: s.levelFog[id] ?? null,
        fogVersion: s.fogVersion + 1,
        ...TOOLS_OFF,
      }
    }),
  showLevelOnTable: (id) =>
    set((s) => {
      const to = id ?? s.levelId
      if (to === s.tableLevelId) return s
      const all = allLevels(s)
      const from = all.find((l) => l.id === s.tableLevelId)
      const target = all.find((l) => l.id === to)
      if (!target) return s
      // The party goes along to the floor shown, to the same place (floors line up).
      const moved = from ? moveParty(from.lights, target.lights) : null
      const levels = all.map((l) =>
        moved && l.id === from!.id ? { ...l, lights: moved.from } : moved && l.id === to ? { ...l, lights: moved.to } : l,
      )
      const viewed = levels.find((l) => l.id === s.levelId)!
      return { levels, tableLevelId: to, scene: applyLevel(s.scene, viewed) }
    }),
  addLevel: () => {
    const s = get()
    const level = emptyLevel(crypto.randomUUID(), `Floor ${s.levels.length + 1}`, s.scene)
    set({ levels: [...allLevels(s), level] })
    get().viewLevel(level.id)
  },
  renameLevel: (id, name) =>
    set((s) => ({ levels: s.levels.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) })),
  moveLevel: (id, by) =>
    set((s) => {
      const i = s.levels.findIndex((l) => l.id === id)
      const j = i + by
      if (i < 0 || j < 0 || j >= s.levels.length) return s
      const levels = [...s.levels]
      ;[levels[i], levels[j]] = [levels[j], levels[i]]
      return { levels }
    }),
  deleteLevel: (id) => {
    const s = get()
    const i = s.levels.findIndex((l) => l.id === id)
    if (i < 0 || s.levels.length <= 1) return
    const neighbour = s.levels[i === 0 ? 1 : i - 1].id
    if (s.tableLevelId === id) get().showLevelOnTable(neighbour)
    if (get().levelId === id) get().viewLevel(neighbour)
    set((t) => {
      const { [id]: _image, ...levelImages } = t.levelImages
      const { [id]: _fog, ...levelFog } = t.levelFog
      void _image
      void _fog
      return { levels: t.levels.filter((l) => l.id !== id), levelImages, levelFog }
    })
  },
  setOnionSkin: (onionSkin) => set({ onionSkin }),
  display: defaultDisplay,
  calibrating: false,
  mapImage: null,
  tableScreen: defaultTableScreen,
  tableConnected: false,
  selectedLightIds: [],
  selectedWallPoints: [],
  selectedObjectIds: [],
  objectImages: {},
  placingLight: null,
  hideTool: null,
  hideMode: 'fill',
  hideBrush: 1,
  // One tool at a time: hiding puts the others (and selections) away.
  setHideTool: (hideTool) => set(hideTool ? { ...TOOLS_OFF, hideTool, hideMode: hideTool } : { hideTool }),
  toggleHideTool: () => {
    const { hideTool, hideMode, setHideTool } = useGm.getState()
    setHideTool(hideTool ? null : hideMode)
  },
  setHideBrush: (hideBrush) => set({ hideBrush }),
  hideFill: (p) => {
    const { scene } = useGm.getState()
    const bounds = sceneBounds(scene)
    const grid = editableMask(scene.hidden, bounds)
    const result = fillHidden(grid, bounds, scene.walls, p)
    if (result === 'filled' || result === 'revealed') {
      set((s) => ({ scene: { ...s.scene, hidden: encodeHidden(grid.cols, grid.rows, grid.mask) } }))
    }
    return result
  },
  hidePaint: (from, to, erase) =>
    set((s) => {
      const bounds = sceneBounds(s.scene)
      const grid = editableMask(s.scene.hidden, bounds)
      const radius = s.hideBrush * s.scene.grid.size
      if (!paintHidden(grid, bounds, from, to, radius, erase ? 0 : 1)) return s
      return { scene: { ...s.scene, hidden: encodeHidden(grid.cols, grid.rows, grid.mask) } }
    }),
  revealAll: () => set((s) => (s.scene.hidden ? { scene: { ...s.scene, hidden: null } } : s)),
  setHiddenSoftness: (hiddenSoftness) => set((s) => ({ scene: { ...s.scene, hiddenSoftness } })),
  gmVision: DEFAULT_GM_VISION,
  peeking: false,
  fogMemory: null,
  fogVersion: 0,
  buildingWalls: false,
  snap: 1,
  wallDraft: [],
  buildingDoors: false,
  doorDraft: null,
  gmCamera: null,
  cameraVersion: 0,
  sceneName: null,
  unsaved: false,

  setGrid: (patch) =>
    set((s) => {
      const { grid, map } = s.scene
      const next = { ...grid, ...patch }
      // A grid-locked map follows grid changes so the two stay matched.
      const nextMap = map?.lockToGrid ? followGrid(map, grid, next) : map
      return { scene: { ...s.scene, grid: next, ...placeMap(s.scene, nextMap) } }
    }),
  setDisplay: (patch) => set((s) => ({ display: { ...s.display, ...patch } })),
  setSquareMm: (squareMm) => set((s) => ({ scene: { ...s.scene, squareMm } })),
  setViewZoom: (zoom) =>
    set((s) => {
      const viewZoom = clampViewZoom(zoom)
      return (s.scene.viewZoom ?? 1) === viewZoom ? s : { scene: { ...s.scene, viewZoom } }
    }),
  setView: (view, safe = false) => {
    const s = useGm.getState()
    if (s.levelId !== s.tableLevelId) {
      // Viewing another floor: the party (on the table's floor) still travels with the view.
      const dx = view.x - s.scene.view.x
      const dy = view.y - s.scene.view.y
      const levels = s.levels.map((l) =>
        l.id === s.tableLevelId
          ? { ...l, lights: l.lights.map((t) => (t.followView ? { ...t, x: t.x + dx, y: t.y + dy } : t)) }
          : l,
      )
      set({ scene: { ...s.scene, view }, levels })
      return true
    }
    // Lights carried by the party travel with the table view.
    const dx = view.x - s.scene.view.x
    const dy = view.y - s.scene.view.y
    const guarded = safe && s.scene.fog.safety
    const segments = guarded ? wallSegments(s.scene.walls) : []
    let stuck = false
    const lights = s.scene.lights.map((l) => {
      if (!l.followView) return l
      if (!guarded || !l.vision) return { ...l, x: l.x + dx, y: l.y + dy }
      // A vision token stops at walls: it slides along them where it can, else stays put.
      const to = [
        { x: l.x + dx, y: l.y + dy },
        { x: l.x + dx, y: l.y },
        { x: l.x, y: l.y + dy },
      ].find((p) => !moveCrossesWall(l, p, segments))
      if (!to || to.x !== l.x + dx || to.y !== l.y + dy) stuck = true
      return to ? { ...l, ...to } : l
    })
    if (stuck) {
      // Held back, it must still be within the view; if not, the view stays where it is.
      const scene = { ...s.scene, view }
      const corners = s.tableScreen && tableViewCorners(scene, s.display, s.tableScreen)
      const outside = lights.some((l) => l.followView && l.vision && (!corners || !pointInPolygon(l, corners)))
      if (outside) {
        s.notify(
          'VISION SAFETY — a vision token travelling with the PVB hit a wall and would have left the PVB, ' +
            'so the PVB was dropped. Hold Alt to move through walls.',
        )
        return false
      }
    }
    set({ scene: { ...s.scene, view, lights } })
    return true
  },
  setDarkness: (darkness) => set((s) => ({ scene: { ...s.scene, darkness } })),
  setGmVision: (gmVision) => set({ gmVision }),
  setGmCamera: (gmCamera) => set({ gmCamera }),
  history: { canUndo: false, canRedo: false },
  historyEpoch: 0,
  newScene: () => {
    set((s) => ({
      scene: defaultScene,
      levels: [firstLevel(defaultScene)],
      levelId: FIRST_LEVEL,
      tableLevelId: FIRST_LEVEL,
      levelImages: {},
      levelFog: {},
      mapImage: null,
      fogMemory: null,
      fogVersion: s.fogVersion + 1,
      gmCamera: null,
      cameraVersion: s.cameraVersion + 1,
      historyEpoch: s.historyEpoch + 1,
      objectImages: {},
      ...TOOLS_OFF,
    }))
    // After the scene change, which marks unsaved (see sync).
    set({ sceneName: null, unsaved: false })
  },
  loadScene: (file, name) => {
    set((s) => {
      const shared = migrateScene(file.scene)
      const levels = file.levels.map((l) => migrateLevel(l, shared))
      const viewed = levels.find((l) => l.id === file.levelId) ?? levels[0]
      const tableLevelId = levels.some((l) => l.id === file.tableLevelId) ? file.tableLevelId : viewed.id
      return {
        historyEpoch: s.historyEpoch + 1,
        levels,
        levelId: viewed.id,
        tableLevelId,
        scene: applyLevel(shared, viewed),
        levelImages: file.mapImages,
        levelFog: file.fogMemories,
        display: { ...s.display, orientation: file.orientation },
        mapImage: file.mapImages[viewed.id] ?? null,
        fogMemory: file.fogMemories[viewed.id] ?? null,
        fogVersion: s.fogVersion + 1,
        gmCamera: file.camera,
        cameraVersion: s.cameraVersion + 1,
        objectImages: file.objectImages,
        // A fresh start for the GM's tools.
        ...TOOLS_OFF,
      }
    })
    // After the scene change, which marks unsaved (see sync).
    set({ sceneName: name, unsaved: false })
  },
  markSaved: (sceneName) => set({ sceneName, unsaved: false }),
  markUnsaved: () => set({ unsaved: true }),
  setVisionSafety: (safety) => set((s) => ({ scene: { ...s.scene, fog: { ...s.scene.fog, safety } } })),
  notice: null,
  notify: (text) => set((s) => ({ notice: { text, id: (s.notice?.id ?? 0) + 1 } })),
  setFogEnabled: (enabled) => {
    set((s) => ({ scene: { ...s.scene, fog: { ...s.scene.fog, enabled } } }))
    useGm.getState().stampFog()
  },
  stampFog: () =>
    set((s) => {
      // The party explores the floor the table shows.
      if (!s.scene.fog.enabled || s.levelId !== s.tableLevelId) return s
      const bounds = sceneBounds(s.scene)
      // A memory made for another map (different shape) starts over.
      const memory = s.fogMemory && fitsBounds(s.fogMemory, bounds) ? s.fogMemory : createFogMemory(bounds)
      if (memory !== stamped.memory) {
        stamped.memory = memory
        stamped.viewers.clear()
      }
      const segments = wallSegments(s.scene.walls)
      const viewers = s.scene.lights
        .filter((l) => l.vision)
        .filter((l) => {
          // Skip viewers that haven't moved on the map (nor walls changed) since their last
          // stamp: they can't reveal anything new.
          const key = `${l.x - bounds.x},${l.y - bounds.y},${bounds.width},${l.visionRange * s.scene.grid.size}`
          const last = stamped.viewers.get(l.id)
          // Revealing an area lets a viewer that hasn't moved remember what's in it.
          const { walls, hidden } = s.scene
          if (last && last.key === key && last.walls === walls && last.hidden === hidden) return false
          stamped.viewers.set(l.id, { key, walls, hidden })
          return true
        })
        .map((l) => {
          const range = l.visionRange * s.scene.grid.size
          if (!segments.length) return { x: l.x, y: l.y, range }
          // Walls block sight: only what's in line of sight is remembered, and nothing
          // beyond the walls needs looking at.
          const polygon = visibilityPolygon(l, range, segments)
          return { x: l.x, y: l.y, range, sees: createVisibilityTest(l, polygon), reach: boundingRect(polygon) }
        })
      const hidden = hiddenMask(s.scene.hidden, bounds)
      const changed = viewers.length > 0 && stampVision(memory, bounds, viewers, hidden)
      if (!changed && memory === s.fogMemory) return s
      return { fogMemory: memory, fogVersion: s.fogVersion + 1 }
    }),
  setBuildingWalls: (buildingWalls) =>
    // One tool at a time: building walls cancels placing a light or building doors.
    set((s) => ({
      buildingWalls,
      wallDraft: [],
      buildingDoors: buildingWalls ? false : s.buildingDoors,
      doorDraft: null,
      placingLight: buildingWalls ? null : s.placingLight,
      hideTool: buildingWalls ? null : s.hideTool,
      // The wall toolbox takes the selection panels' place.
      selectedLightIds: buildingWalls ? [] : s.selectedLightIds,
      selectedWallPoints: buildingWalls ? [] : s.selectedWallPoints,
    })),
  setSnap: (snap) => set({ snap }),
  addWallPoint: (p) =>
    set((s) => {
      const draft = s.wallDraft
      const last = draft.at(-1)
      if (last && sameSpot(last, p)) return s // a double click, not a new point
      // Back at the start of a shape: close it and finish the wall.
      if (draft.length >= 3 && sameSpot(draft[0], p)) {
        const wall: Wall = { id: crypto.randomUUID(), points: [...draft, { ...draft[0] }] }
        return { scene: { ...s.scene, walls: [...s.scene.walls, wall] }, wallDraft: [] }
      }
      return { wallDraft: [...draft, p] }
    }),
  undoWallPoint: () => set((s) => ({ wallDraft: s.wallDraft.slice(0, -1) })),
  cancelWallDraft: () => set({ wallDraft: [] }),
  confirmWallDraft: () =>
    set((s) => {
      if (s.wallDraft.length < 2) return { wallDraft: [] }
      const wall: Wall = { id: crypto.randomUUID(), points: s.wallDraft }
      return { scene: { ...s.scene, walls: [...s.scene.walls, wall] }, wallDraft: [] }
    }),
  clearWalls: () => set((s) => ({ scene: { ...s.scene, walls: [] }, wallDraft: [], selectedWallPoints: [] })),
  addDetectedWalls: (detected, replace) =>
    set((s) => {
      const map = s.scene.map
      if (!map) return s
      // Detected in the image as shown (turned), in its pixels.
      const kx = map.width / mapNatural(map).width
      const ky = map.height / mapNatural(map).height
      const added: Wall[] = detected.map((w) => ({
        id: crypto.randomUUID(),
        points: w.points.map((p) => ({ x: map.x + p.x * kx, y: map.y + p.y * ky })),
        ...(w.door && { door: { open: false } }),
      }))
      const walls = replace ? added : [...s.scene.walls, ...added]
      return { scene: { ...s.scene, walls }, selectedWallPoints: [], wallDraft: [] }
    }),
  setBuildingDoors: (buildingDoors) =>
    set((s) => ({
      buildingDoors,
      doorDraft: null,
      buildingWalls: buildingDoors ? false : s.buildingWalls,
      wallDraft: buildingDoors ? [] : s.wallDraft,
      placingLight: buildingDoors ? null : s.placingLight,
      hideTool: buildingDoors ? null : s.hideTool,
      selectedLightIds: buildingDoors ? [] : s.selectedLightIds,
      selectedWallPoints: buildingDoors ? [] : s.selectedWallPoints,
    })),
  placeDoorPoint: (p) =>
    set((s) => {
      const first = s.doorDraft
      if (!first) return { doorDraft: p }
      const walls = makeDoor(s.scene.walls, first, p, () => crypto.randomUUID())
      // Not on the same stretch of wall as the first point: start over from here.
      if (!walls) return { doorDraft: p }
      return { scene: { ...s.scene, walls }, doorDraft: null }
    }),
  cancelDoorDraft: () => set({ doorDraft: null }),
  toggleDoor: (id) =>
    set((s) => ({
      scene: {
        ...s.scene,
        walls: s.scene.walls.map((w) => (w.id === id && w.door ? { ...w, door: { open: !w.door.open } } : w)),
      },
    })),
  convertToDoor: (refs) =>
    set((s) => {
      const span = selectedSegment(s.scene.walls, refs)
      const walls = span && makeDoor(s.scene.walls, span.a, span.b, () => crypto.randomUUID())
      if (!walls) return s
      return { scene: { ...s.scene, walls }, selectedWallPoints: [] }
    }),
  resetFog: () => {
    set((s) => ({ fogMemory: createFogMemory(sceneBounds(s.scene)), fogVersion: s.fogVersion + 1 }))
    useGm.getState().stampFog()
  },
  setPeeking: (peeking) => set({ peeking }),
  addLight: (kind, at) =>
    set((s) => {
      const light = createLight(kind, at.x, at.y, crypto.randomUUID())
      return {
        scene: { ...s.scene, lights: [...s.scene.lights, light] },
        selectedLightIds: [light.id],
        selectedWallPoints: [],
      }
    }),
  updateLight: (id, patch) =>
    set((s) => ({
      scene: { ...s.scene, lights: s.scene.lights.map((l) => (l.id === id ? { ...l, ...patch } : l)) },
    })),
  updateLights: (ids, patch) =>
    set((s) => {
      const chosen = new Set(ids)
      const lights = s.scene.lights.map((l) =>
        chosen.has(l.id) ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l,
      )
      return { scene: { ...s.scene, lights } }
    }),
  moveLights: (ids, dx, dy, safe = false) => {
    const s = useGm.getState()
    const chosen = new Set(ids)
    if (safe && s.scene.fog.safety) {
      const segments = wallSegments(s.scene.walls)
      const crossing = s.scene.lights.some(
        (l) => chosen.has(l.id) && l.vision && moveCrossesWall(l, { x: l.x + dx, y: l.y + dy }, segments),
      )
      if (crossing) {
        s.notify('VISION SAFETY — a vision token tried to cross a wall and was dropped. Hold Alt to move through walls.')
        return false
      }
    }
    const lights = s.scene.lights.map((l) => (chosen.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l))
    set({ scene: { ...s.scene, lights } })
    return true
  },
  removeLights: (ids) =>
    set((s) => {
      const gone = new Set(ids)
      return {
        scene: { ...s.scene, lights: s.scene.lights.filter((l) => !gone.has(l.id)) },
        selectedLightIds: s.selectedLightIds.filter((id) => !gone.has(id)),
      }
    }),
  selectLight: (id) => set({ selectedLightIds: id ? [id] : [], selectedWallPoints: [], selectedObjectIds: [] }),
  selectWallPoint: (ref) =>
    set((s) => ({ selectedWallPoints: withLinked(s.scene.walls, [ref]), selectedLightIds: [], selectedObjectIds: [] })),
  toggleWallPointSelected: (ref) =>
    set((s) => {
      const group = withLinked(s.scene.walls, [ref])
      const selected = s.selectedWallPoints.some((r) => sameRef(r, ref))
      return {
        selectedWallPoints: selected
          ? s.selectedWallPoints.filter((r) => !group.some((g) => sameRef(g, r)))
          : [...s.selectedWallPoints, ...group.filter((g) => !s.selectedWallPoints.some((r) => sameRef(r, g)))],
      }
    }),
  selectMany: (lightIds, wallPoints, add) =>
    set((s) => ({
      selectedObjectIds: add ? s.selectedObjectIds : [],
      selectedLightIds: add ? [...new Set([...s.selectedLightIds, ...lightIds])] : lightIds,
      selectedWallPoints: add
        ? [...s.selectedWallPoints, ...wallPoints.filter((p) => !s.selectedWallPoints.some((r) => sameRef(r, p)))]
        : wallPoints,
    })),
  moveWallPoints: (refs, dx, dy) =>
    set((s) => ({ scene: { ...s.scene, walls: moveWallPoints(s.scene.walls, refs, dx, dy) } })),
  deleteWallPoints: (refs) =>
    set((s) => ({
      // Linked points go together: deleting a corner deletes it from every wall meeting there.
      scene: {
        ...s.scene,
        walls: deleteWallPoints(s.scene.walls, withLinked(s.scene.walls, refs), () => crypto.randomUUID()),
      },
      // Indices shift when walls are cut, so the wall point selection is done with.
      selectedWallPoints: [],
    })),
  deleteSelection: () => {
    const { selectedLightIds, selectedWallPoints, selectedObjectIds, removeLights, deleteWallPoints, removeObjects } =
      useGm.getState()
    if (selectedWallPoints.length) deleteWallPoints(selectedWallPoints)
    if (selectedLightIds.length) removeLights(selectedLightIds)
    if (selectedObjectIds.length) removeObjects(selectedObjectIds)
  },
  setObjectImage: (asset, image) => set((s) => ({ objectImages: { ...s.objectImages, [asset]: image } })),
  addObject: (object) =>
    set((s) => {
      const placed: MapObject = { ...object, id: crypto.randomUUID() }
      return {
        scene: { ...s.scene, objects: [...s.scene.objects, placed] },
        selectedObjectIds: [placed.id],
        selectedLightIds: [],
        selectedWallPoints: [],
      }
    }),
  updateObject: (id, patch) =>
    set((s) => ({
      scene: { ...s.scene, objects: s.scene.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) },
    })),
  removeObjects: (ids) =>
    set((s) => {
      const gone = new Set(ids)
      return {
        scene: { ...s.scene, objects: s.scene.objects.filter((o) => !gone.has(o.id)) },
        selectedObjectIds: s.selectedObjectIds.filter((id) => !gone.has(id)),
      }
    }),
  selectObject: (id) =>
    set({ selectedObjectIds: id ? [id] : [], selectedLightIds: [], selectedWallPoints: [] }),
  reorderObject: (id, to) =>
    set((s) => {
      const o = s.scene.objects.find((x) => x.id === id)
      if (!o) return s
      const rest = s.scene.objects.filter((x) => x.id !== id)
      return { scene: { ...s.scene, objects: to === 'front' ? [...rest, o] : [o, ...rest] } }
    }),
  toggleLightSelected: (id) =>
    set((s) => ({
      selectedLightIds: s.selectedLightIds.includes(id)
        ? s.selectedLightIds.filter((x) => x !== id)
        : [...s.selectedLightIds, id],
    })),
  setPlacingLight: (placingLight) =>
    set((s) => ({
      placingLight,
      buildingWalls: placingLight ? false : s.buildingWalls,
      wallDraft: placingLight ? [] : s.wallDraft,
      buildingDoors: placingLight ? false : s.buildingDoors,
      doorDraft: placingLight ? null : s.doorDraft,
      hideTool: placingLight ? null : s.hideTool,
    })),
  setMap: (mapImage, size) =>
    set((s) => ({
      mapImage,
      // Memory belongs to the old map.
      fogMemory: null,
      fogVersion: s.fogVersion + 1,
      scene: {
        ...s.scene,
        map: size && { x: 0, y: 0, ...size, naturalWidth: size.width, naturalHeight: size.height },
        // Hidden areas belong to the old map too.
        hidden: null,
        // A first map: the table view goes to it (not when preparing another floor).
        view: size && s.levelId === s.tableLevelId ? { x: size.width / 2, y: size.height / 2 } : s.scene.view,
      },
    })),
  setMapScale: (scale) =>
    set((s) => {
      const map = s.scene.map
      if (!map || map.lockToGrid) return s
      const width = mapNatural(map).width * scale
      const height = mapNatural(map).height * scale
      return { scene: { ...s.scene, ...placeMap(s.scene, { ...map, width, height }) } }
    }),
  setMapPosition: ({ x, y }) =>
    set((s) => {
      const { map, grid } = s.scene
      if (!map) return s
      const next = { ...map, x: map.lockX ? map.x : x, y: map.lockY ? map.y : y }
      if (!map.lockToGrid) return { scene: { ...s.scene, ...placeMap(s.scene, next) } }
      // Keep offsets within one cell; the grid looks the same either way.
      const wrap = (v: number) => ((v % grid.size) + grid.size) % grid.size
      return {
        scene: {
          ...s.scene,
          ...placeMap(s.scene, next),
          grid: {
            ...grid,
            offsetX: wrap(grid.offsetX + next.x - map.x),
            offsetY: wrap(grid.offsetY + next.y - map.y),
          },
        },
      }
    }),
  fitMapToView: (axis) =>
    set((s) => {
      const map = s.scene.map
      if (!map || map.lockToGrid) return s
      const view = boundingRect(tableViewCorners(s.scene, s.display, s.tableScreen))
      return { scene: { ...s.scene, ...placeMap(s.scene, fitMapToRect(map, view, axis)) } }
    }),
  alignMapToGrid: (cell) =>
    set((s) => {
      const map = s.scene.map
      if (!map) return s
      return {
        scene: {
          ...s.scene,
          ...placeMap(s.scene, { ...alignMapToGrid(map, s.scene.grid, cell), lockToGrid: true }),
          grid: { ...s.scene.grid, visible: true },
        },
      }
    }),
  restoreMap: (map) => set((s) => ({ scene: { ...s.scene, ...placeMap(s.scene, map) } })),
  turnMap: (direction) =>
    set((s) => {
      const { map, grid } = s.scene
      if (!map) return s
      const pivot = mapPivot(map, grid)
      const turn = (p: Point) => turnPoint(p, pivot, direction)
      const quarter = (direction * Math.PI) / 2
      // The table view (shared by the floors) follows only when this floor is on the table.
      const onTable = s.levelId === s.tableLevelId
      return {
        scene: {
          ...s.scene,
          map: { ...map, ...turnRect(map, pivot, direction), turns: ((((map.turns ?? 0) + direction) % 4) + 4) % 4 },
          walls: s.scene.walls.map((w) => ({ ...w, points: w.points.map(turn) })),
          lights: s.scene.lights.map((l) => ({ ...l, ...turn(l), angle: l.angle + quarter })),
          objects: s.scene.objects.map((o) => ({ ...o, ...turn(o), rotation: o.rotation + quarter })),
          hidden: s.scene.hidden && turnHidden(s.scene.hidden, direction),
          view: onTable ? turn(s.scene.view) : s.scene.view,
        },
        // What's been explored turns with the map it covers.
        fogMemory: s.fogMemory && turnFogMemory(s.fogMemory, direction),
        fogVersion: s.fogVersion + 1,
        wallDraft: [],
        doorDraft: null,
      }
    }),
  setMapLock: (axis, locked) =>
    set((s) => {
      const map = s.scene.map
      if (!map) return s
      return { scene: { ...s.scene, map: { ...map, [axis === 'x' ? 'lockX' : 'lockY']: locked } } }
    }),
  setMapLockToGrid: (locked) =>
    set((s) => {
      const map = s.scene.map
      if (!map) return s
      return { scene: { ...s.scene, map: { ...map, lockToGrid: locked } } }
    }),
  setCalibrating: (calibrating) => set({ calibrating }),
  setTableScreen: (screen) =>
    set((s) =>
      s.tableConnected && s.tableScreen.width === screen.width && s.tableScreen.height === screen.height
        ? s
        : { tableScreen: screen, tableConnected: true },
    ),
  setTableDisconnected: () => set({ tableConnected: false }),
}))

/**
 * A new placement for the map, with the lights on it carried along so they stay on the
 * things drawn there. Lights travelling with the table view belong to the party, not the
 * map, so they stay put.
 */
function placeMap(scene: Scene, map: MapInfo | null): Pick<Scene, 'map' | 'lights' | 'walls' | 'objects'> {
  const from = scene.map
  const unchanged =
    !from || !map || (from.x === map.x && from.y === map.y && from.width === map.width)
  if (unchanged) return { map, lights: scene.lights, walls: scene.walls, objects: scene.objects }
  return {
    // Objects are on the map: they move and scale with it.
    objects: scene.objects.map((o) => carryObject(o, from, map)),
    map,
    lights: scene.lights.map((l) => (l.followView ? l : { ...l, ...carryPoint(l, from, map) })),
    // Walls are drawn on the map, so they always go with it.
    walls: scene.walls.map((w) => ({ ...w, points: w.points.map((p) => carryPoint(p, from, map)) })),
  }
}

/** What the table shows: its floor, with the shared parts of the scene. */
export function tableState(s: GmStore): TableState {
  const level = s.tableLevelId === s.levelId ? null : s.levels.find((l) => l.id === s.tableLevelId)
  return { scene: level ? applyLevel(s.scene, level) : s.scene, display: s.display, calibrating: s.calibrating }
}

/** Restore the last session from IndexedDB. */
/**
 * Fill in fields missing from scenes saved by earlier versions (in the session store or in
 * a scene file), so old saves keep opening.
 */
export function migrateScene(scene: Scene): Scene {
  scene.grid = { ...DEFAULT_GRID_STYLE, ...scene.grid }
  scene.darkness ??= 0
  scene.lights ??= []
  const fog: Partial<Scene['fog']> = scene.fog ?? {}
  scene.fog = { enabled: fog.enabled ?? false, safety: fog.safety ?? true }
  scene.walls ??= []
  scene.objects ??= []
  for (const l of scene.lights) {
    l.vision ??= LIGHT_PRESETS[l.kind].handheld
    l.visionRange ??= DEFAULT_VISION_RANGE
  }
  const map = scene.map as (Partial<MapInfo> & Size) | null
  if (map) {
    map.naturalWidth ??= map.width
    map.naturalHeight ??= map.height
    map.x ??= 0
    map.y ??= 0
  }
  return scene
}

/** The floors, as kept between sessions (the viewed floor is in the saved scene). */
export interface SavedFloors {
  levels: Level[]
  levelId: string
  tableLevelId: string
  levelImages: Record<string, Blob | null>
  levelFog: Record<string, FogMemory | null>
}

/** A floor saved by an earlier version: fill in what's missing, as for scenes. */
function migrateLevel(level: Level, shared: Scene): Level {
  const scene = migrateScene(applyLevel(shared, { ...level, objects: level.objects ?? [], walls: level.walls ?? [] }))
  return extractLevel(scene, level)
}

/** Restore the last session from IndexedDB. */
export async function hydrate() {
  const [scene, display, mapImage, tableScreen, gmVision, fogMemory, gmCamera, sceneName, objectImages, floors] =
    await Promise.all([
      load<Scene>('scene'),
      load<Display>('display'),
      load<Blob | null>('mapImage'),
      load<Size>('tableScreen'),
      load<number>('gmVision'),
      load<FogMemory>('fogMemory'),
      load<GmCamera>('gmCamera'),
      load<{ name: string | null; unsaved: boolean }>('sceneName'),
      load<AssetImages>('objectImages'),
      load<SavedFloors>('floors'),
    ])
  const restored = scene ? migrateScene(scene) : defaultScene
  // Sessions from before floors: the scene is the one floor.
  const valid = floors?.levels.some((l) => l.id === floors.levelId)
  const levels = valid ? floors!.levels.map((l) => migrateLevel(l, restored)) : [firstLevel(restored)]
  const levelId = valid ? floors!.levelId : levels[0].id
  const tableLevelId = valid && levels.some((l) => l.id === floors!.tableLevelId) ? floors!.tableLevelId : levelId
  useGm.setState((s) => ({
    scene: restored,
    levels,
    levelId,
    tableLevelId,
    levelImages: (valid && floors!.levelImages) || {},
    levelFog: (valid && floors!.levelFog) || {},
    display: display ?? defaultDisplay,
    mapImage: mapImage ?? null,
    tableScreen: tableScreen ?? defaultTableScreen,
    gmVision: gmVision ?? DEFAULT_GM_VISION,
    fogMemory: fogMemory ?? null,
    gmCamera: gmCamera ?? null,
    objectImages: objectImages ?? {},
    cameraVersion: s.cameraVersion + 1,
    sceneName: sceneName?.name ?? null,
    unsaved: sceneName?.unsaved ?? false,
  }))
}
