import { create } from 'zustand'
import {
  alignMapToGrid,
  boundingRect,
  fitMapToRect,
  followGrid,
  tableViewCorners,
} from '../shared/geometry'
import { createLight, type Light, type LightKind } from '../shared/lights'
import { load } from '../shared/persist'
import type { Display, GridSettings, MapInfo, Point, Scene, Size, TableState } from '../shared/types'

export const MM_PER_INCH = 25.4

const DEFAULT_GRID_STYLE = { color: '#ffffff', opacity: 0.35 }

interface GmStore extends TableState {
  mapImage: Blob | null
  /** Size of the table window; the last known size while none is connected. */
  tableScreen: Size
  tableConnected: boolean
  /** The light whose token is selected in the GM view (GM-only, not sent to the table). */
  selectedLightId: string | null

  setGrid(patch: Partial<GridSettings>): void
  setDisplay(patch: Partial<Display>): void
  setSquareMm(mm: number): void
  setView(view: Point): void
  setDarkness(darkness: number): void
  /** Add a light at a scene position and select it. */
  addLight(kind: LightKind, at: Point): void
  updateLight(id: string, patch: Partial<Light>): void
  removeLight(id: string): void
  selectLight(id: string | null): void
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
  selectedLightId: null,

  setGrid: (patch) =>
    set((s) => {
      const { grid, map } = s.scene
      const next = { ...grid, ...patch }
      // A grid-locked map follows grid changes so the two stay matched.
      const nextMap = map?.lockToGrid ? followGrid(map, grid, next) : map
      return { scene: { ...s.scene, grid: next, map: nextMap } }
    }),
  setDisplay: (patch) => set((s) => ({ display: { ...s.display, ...patch } })),
  setSquareMm: (squareMm) => set((s) => ({ scene: { ...s.scene, squareMm } })),
  setView: (view) => set((s) => ({ scene: { ...s.scene, view } })),
  setDarkness: (darkness) => set((s) => ({ scene: { ...s.scene, darkness } })),
  addLight: (kind, at) =>
    set((s) => {
      const light = createLight(kind, at.x, at.y, crypto.randomUUID())
      return { scene: { ...s.scene, lights: [...s.scene.lights, light] }, selectedLightId: light.id }
    }),
  updateLight: (id, patch) =>
    set((s) => ({
      scene: { ...s.scene, lights: s.scene.lights.map((l) => (l.id === id ? { ...l, ...patch } : l)) },
    })),
  removeLight: (id) =>
    set((s) => ({
      scene: { ...s.scene, lights: s.scene.lights.filter((l) => l.id !== id) },
      selectedLightId: s.selectedLightId === id ? null : s.selectedLightId,
    })),
  selectLight: (selectedLightId) => set({ selectedLightId }),
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
      return { scene: { ...s.scene, map: { ...map, width, height } } }
    }),
  setMapPosition: ({ x, y }) =>
    set((s) => {
      const { map, grid } = s.scene
      if (!map) return s
      const next = { ...map, x: map.lockX ? map.x : x, y: map.lockY ? map.y : y }
      if (!map.lockToGrid) return { scene: { ...s.scene, map: next } }
      // Keep offsets within one cell; the grid looks the same either way.
      const wrap = (v: number) => ((v % grid.size) + grid.size) % grid.size
      return {
        scene: {
          ...s.scene,
          map: next,
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
      return { scene: { ...s.scene, map: fitMapToRect(map, view, axis) } }
    }),
  alignMapToGrid: (cell) =>
    set((s) => {
      const map = s.scene.map
      if (!map) return s
      return {
        scene: {
          ...s.scene,
          map: { ...alignMapToGrid(map, s.scene.grid, cell), lockToGrid: true },
          grid: { ...s.scene.grid, visible: true },
        },
      }
    }),
  restoreMap: (map) => set((s) => ({ scene: { ...s.scene, map } })),
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

export function tableState(s: GmStore): TableState {
  return { scene: s.scene, display: s.display, calibrating: s.calibrating }
}

/** Restore the last session from IndexedDB. */
export async function hydrate() {
  const [scene, display, mapImage, tableScreen] = await Promise.all([
    load<Scene>('scene'),
    load<Display>('display'),
    load<Blob | null>('mapImage'),
    load<Size>('tableScreen'),
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
  })
}
