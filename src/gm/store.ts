import { create } from 'zustand'
import {
  alignMapToGrid,
  boundingRect,
  carryPoint,
  fitMapToRect,
  followGrid,
  tableViewCorners,
} from '../shared/geometry'
import { createLight, type Light, type LightKind } from '../shared/lights'
import { load } from '../shared/persist'
import type { Display, GridSettings, MapInfo, Point, Scene, Size, TableState } from '../shared/types'

export const MM_PER_INCH = 25.4

const DEFAULT_GRID_STYLE = { color: '#ffffff', opacity: 0.35 }

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
  /** A light kind waiting to be placed with a click on the map (GM-only). */
  placingLight: LightKind | null
  /**
   * How much of the night the GM is spared, 0 (sees what the players see) to 1 (full day).
   * A GM preference: it never affects the table.
   */
  gmVision: number
  /** Temporarily show the GM exactly what the players see (while a peek key/button is held). */
  peeking: boolean

  setGrid(patch: Partial<GridSettings>): void
  setDisplay(patch: Partial<Display>): void
  setSquareMm(mm: number): void
  setView(view: Point): void
  setDarkness(darkness: number): void
  setGmVision(vision: number): void
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
  /** Select just this light (or none). */
  selectLight(id: string | null): void
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
}

// 96 CSS px per inch is the nominal value; real TVs differ, hence calibration.
const defaultDisplay: Display = { pxPerMm: 96 / MM_PER_INCH, orientation: 0 }

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
  placingLight: null,
  gmVision: DEFAULT_GM_VISION,
  peeking: false,

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
  setPeeking: (peeking) => set({ peeking }),
  addLight: (kind, at) =>
    set((s) => {
      const light = createLight(kind, at.x, at.y, crypto.randomUUID())
      return { scene: { ...s.scene, lights: [...s.scene.lights, light] }, selectedLightIds: [light.id] }
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
  selectLight: (id) => set({ selectedLightIds: id ? [id] : [] }),
  toggleLightSelected: (id) =>
    set((s) => ({
      selectedLightIds: s.selectedLightIds.includes(id)
        ? s.selectedLightIds.filter((x) => x !== id)
        : [...s.selectedLightIds, id],
    })),
  setPlacingLight: (placingLight) => set({ placingLight }),
  setMap: (mapImage, size) =>
    set((s) => ({
      mapImage,
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
function placeMap(scene: Scene, map: MapInfo | null): Pick<Scene, 'map' | 'lights'> {
  const from = scene.map
  const unchanged =
    !from || !map || (from.x === map.x && from.y === map.y && from.width === map.width)
  if (unchanged) return { map, lights: scene.lights }
  return {
    map,
    lights: scene.lights.map((l) => (l.followView ? l : { ...l, ...carryPoint(l, from, map) })),
  }
}

export function tableState(s: GmStore): TableState {
  return { scene: s.scene, display: s.display, calibrating: s.calibrating }
}

/** Restore the last session from IndexedDB. */
export async function hydrate() {
  const [scene, display, mapImage, tableScreen, gmVision] = await Promise.all([
    load<Scene>('scene'),
    load<Display>('display'),
    load<Blob | null>('mapImage'),
    load<Size>('tableScreen'),
    load<number>('gmVision'),
  ])
  // Fill in fields missing from scenes saved by earlier versions.
  if (scene) {
    scene.grid = { ...DEFAULT_GRID_STYLE, ...scene.grid }
    scene.darkness ??= 0
    scene.lights ??= []
  }
  const map = scene?.map as (Partial<MapInfo> & Size) | null | undefined
  if (map) {
    map.naturalWidth ??= map.width
    map.naturalHeight ??= map.height
    map.x ??= 0
    map.y ??= 0
  }
  useGm.setState({
    scene: scene ?? defaultScene,
    display: display ?? defaultDisplay,
    mapImage: mapImage ?? null,
    tableScreen: tableScreen ?? defaultTableScreen,
    gmVision: gmVision ?? DEFAULT_GM_VISION,
  })
}
