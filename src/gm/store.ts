import { create } from 'zustand'
import {
  alignMapToGrid,
  boundingRect,
  carryPoint,
  fitMapToRect,
  sceneBounds,
  followGrid,
  tableViewCorners,
} from '../shared/geometry'
import { createFogMemory, fitsBounds, stampVision, type FogMemory } from '../shared/fog'
import {
  createLight,
  DEFAULT_VISION_RANGE,
  LIGHT_PRESETS,
  type Light,
  type LightKind,
} from '../shared/lights'
import { load } from '../shared/persist'
import type { GmCamera, SceneFile } from '../shared/sceneFile'
import { createVisibilityTest, visibilityPolygon, wallSegments, type Wall } from '../shared/visibility'
import {
  deleteWallPoints,
  moveWallPoints,
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
  viewers: new Map<string, { key: string; walls: Wall[] }>(),
}

/** By default the GM sees half the darkness the players do. */
const DEFAULT_GM_VISION = 0.5

/** How dark the GM's own view is, given the table's darkness and the GM's vision. */
export function gmDarkness(s: Pick<GmStore, 'scene' | 'gmVision' | 'peeking'>): number {
  return s.peeking ? s.scene.darkness : s.scene.darkness * (1 - s.gmVision)
}

interface GmStore extends TableState {
  mapImage: Blob | null
  /** Size of the table window; the last known size while none is connected. */
  tableScreen: Size
  tableConnected: boolean
  /** Lights whose tokens are selected in the GM view (GM-only, not sent to the table). */
  selectedLightIds: string[]
  /** Selected wall points (GM-only). */
  selectedWallPoints: WallPointRef[]
  /** A light kind waiting to be placed with a click on the map (GM-only). */
  placingLight: LightKind | null
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
  /** Snap wall points to every 1, 1/2 or 1/4 square; 0 = no snapping. */
  wallSnap: number
  /** Points of the wall being drawn, not yet confirmed. */
  wallDraft: Point[]
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
  setView(view: Point): void
  setDarkness(darkness: number): void
  setGmVision(vision: number): void
  /** The GM panned or zoomed (doesn't move the camera; the canvas already did). */
  setGmCamera(camera: GmCamera): void
  /** Replace the scene with one from a file. */
  loadScene(file: SceneFile, name: string): void
  /** The scene was just saved under this name. */
  markSaved(name: string): void
  markUnsaved(): void
  setFogEnabled(enabled: boolean): void
  /** Record what vision tokens see now into fog memory (when fog is on). */
  stampFog(): void
  /** Forget everything the party has seen. */
  resetFog(): void
  setBuildingWalls(on: boolean): void
  setWallSnap(fraction: number): void
  addWallPoint(p: Point): void
  /** Take back the last point of the wall being drawn. */
  undoWallPoint(): void
  cancelWallDraft(): void
  /** Turn the drawn points into a wall (needs at least two). */
  confirmWallDraft(): void
  clearWalls(): void
  setPeeking(peeking: boolean): void
  /** Add a light at a scene position and select it. */
  addLight(kind: LightKind, at: Point): void
  /** Start/stop placement mode: the next click on the map places this kind of light. */
  setPlacingLight(kind: LightKind | null): void
  updateLight(id: string, patch: Partial<Light>): void
  /** Change several lights; a function patch can tailor the change to each light. */
  updateLights(ids: string[], patch: Partial<Light> | ((light: Light) => Partial<Light>)): void
  moveLights(ids: string[], dx: number, dy: number): void
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
  /** Delete everything selected: lights and wall points. */
  deleteSelection(): void
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
  fog: { enabled: false },
  walls: [],
}

// Calibrated on the GM's own table TV: the nominal 96 CSS px per inch square measured 137 mm
// instead of 100. Other screens differ; calibration corrects it.
const defaultDisplay: Display = { pxPerMm: (96 / MM_PER_INCH) * (100 / 137), orientation: 0 }

// Until a table window has ever connected, assume a 1080p TV.
const defaultTableScreen: Size = { width: 1920, height: 1080 }

export const useGm = create<GmStore>()((set) => ({
  scene: defaultScene,
  display: defaultDisplay,
  calibrating: false,
  mapImage: null,
  tableScreen: defaultTableScreen,
  tableConnected: false,
  selectedLightIds: [],
  selectedWallPoints: [],
  placingLight: null,
  gmVision: DEFAULT_GM_VISION,
  peeking: false,
  fogMemory: null,
  fogVersion: 0,
  buildingWalls: false,
  wallSnap: 1,
  wallDraft: [],
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
  setView: (view) =>
    set((s) => {
      // Lights carried by the party travel with the table view.
      const dx = view.x - s.scene.view.x
      const dy = view.y - s.scene.view.y
      const lights = s.scene.lights.some((l) => l.followView)
        ? s.scene.lights.map((l) => (l.followView ? { ...l, x: l.x + dx, y: l.y + dy } : l))
        : s.scene.lights
      return { scene: { ...s.scene, view, lights } }
    }),
  setDarkness: (darkness) => set((s) => ({ scene: { ...s.scene, darkness } })),
  setGmVision: (gmVision) => set({ gmVision }),
  setGmCamera: (gmCamera) => set({ gmCamera }),
  loadScene: (file, name) => {
    set((s) => ({
      scene: migrateScene(file.scene),
      display: { ...s.display, orientation: file.orientation },
      mapImage: file.mapImage,
      fogMemory: file.fogMemory,
      fogVersion: s.fogVersion + 1,
      gmCamera: file.camera,
      cameraVersion: s.cameraVersion + 1,
      // A fresh start for the GM's tools.
      selectedLightIds: [],
      selectedWallPoints: [],
      placingLight: null,
      buildingWalls: false,
      wallDraft: [],
    }))
    // After the scene change, which marks unsaved (see sync).
    set({ sceneName: name, unsaved: false })
  },
  markSaved: (sceneName) => set({ sceneName, unsaved: false }),
  markUnsaved: () => set({ unsaved: true }),
  setFogEnabled: (enabled) => {
    set((s) => ({ scene: { ...s.scene, fog: { enabled } } }))
    useGm.getState().stampFog()
  },
  stampFog: () =>
    set((s) => {
      if (!s.scene.fog.enabled) return s
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
          if (last && last.key === key && last.walls === s.scene.walls) return false
          stamped.viewers.set(l.id, { key, walls: s.scene.walls })
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
      const changed = viewers.length > 0 && stampVision(memory, bounds, viewers)
      if (!changed && memory === s.fogMemory) return s
      return { fogMemory: memory, fogVersion: s.fogVersion + 1 }
    }),
  setBuildingWalls: (buildingWalls) =>
    // One tool at a time: building walls cancels placing a light.
    set((s) => ({
      buildingWalls,
      wallDraft: [],
      placingLight: buildingWalls ? null : s.placingLight,
      // The wall toolbox takes the selection panels' place.
      selectedLightIds: buildingWalls ? [] : s.selectedLightIds,
      selectedWallPoints: buildingWalls ? [] : s.selectedWallPoints,
    })),
  setWallSnap: (wallSnap) => set({ wallSnap }),
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
  moveLights: (ids, dx, dy) =>
    set((s) => {
      const chosen = new Set(ids)
      const lights = s.scene.lights.map((l) => (chosen.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l))
      return { scene: { ...s.scene, lights } }
    }),
  removeLights: (ids) =>
    set((s) => {
      const gone = new Set(ids)
      return {
        scene: { ...s.scene, lights: s.scene.lights.filter((l) => !gone.has(l.id)) },
        selectedLightIds: s.selectedLightIds.filter((id) => !gone.has(id)),
      }
    }),
  selectLight: (id) => set({ selectedLightIds: id ? [id] : [], selectedWallPoints: [] }),
  selectWallPoint: (ref) =>
    set((s) => ({ selectedWallPoints: withLinked(s.scene.walls, [ref]), selectedLightIds: [] })),
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
    const { selectedLightIds, selectedWallPoints, removeLights, deleteWallPoints } = useGm.getState()
    if (selectedWallPoints.length) deleteWallPoints(selectedWallPoints)
    if (selectedLightIds.length) removeLights(selectedLightIds)
  },
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
        view: size ? { x: size.width / 2, y: size.height / 2 } : s.scene.view,
      },
    })),
  setMapScale: (scale) =>
    set((s) => {
      const map = s.scene.map
      if (!map || map.lockToGrid) return s
      const width = map.naturalWidth * scale
      const height = map.naturalHeight * scale
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
function placeMap(scene: Scene, map: MapInfo | null): Pick<Scene, 'map' | 'lights' | 'walls'> {
  const from = scene.map
  const unchanged =
    !from || !map || (from.x === map.x && from.y === map.y && from.width === map.width)
  if (unchanged) return { map, lights: scene.lights, walls: scene.walls }
  return {
    map,
    lights: scene.lights.map((l) => (l.followView ? l : { ...l, ...carryPoint(l, from, map) })),
    // Walls are drawn on the map, so they always go with it.
    walls: scene.walls.map((w) => ({ ...w, points: w.points.map((p) => carryPoint(p, from, map)) })),
  }
}

export function tableState(s: GmStore): TableState {
  return { scene: s.scene, display: s.display, calibrating: s.calibrating }
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
  scene.fog ??= { enabled: false }
  scene.walls ??= []
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

/** Restore the last session from IndexedDB. */
export async function hydrate() {
  const [scene, display, mapImage, tableScreen, gmVision, fogMemory, gmCamera, sceneName] =
    await Promise.all([
      load<Scene>('scene'),
      load<Display>('display'),
      load<Blob | null>('mapImage'),
      load<Size>('tableScreen'),
      load<number>('gmVision'),
      load<FogMemory>('fogMemory'),
      load<GmCamera>('gmCamera'),
      load<{ name: string | null; unsaved: boolean }>('sceneName'),
    ])
  useGm.setState((s) => ({
    scene: scene ? migrateScene(scene) : defaultScene,
    display: display ?? defaultDisplay,
    mapImage: mapImage ?? null,
    tableScreen: tableScreen ?? defaultTableScreen,
    gmVision: gmVision ?? DEFAULT_GM_VISION,
    fogMemory: fogMemory ?? null,
    gmCamera: gmCamera ?? null,
    cameraVersion: s.cameraVersion + 1,
    sceneName: sceneName?.name ?? null,
    unsaved: sceneName?.unsaved ?? false,
  }))
}
