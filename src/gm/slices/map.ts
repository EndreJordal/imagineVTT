/** The map image and grid: placing, scaling, turning and matching them. */
import type { StateCreator } from 'zustand'
import { turnFogMemory } from '../../shared/fog'
import { alignMapToGrid, boundingRect, fitMapToRect, followGrid, mapNatural, mapPivot, tableViewCorners, turnPoint, turnRect } from '../../shared/geometry'
import { nothingHidden, turnHidden } from '../../shared/hidden'
import type { GridSettings, MapInfo, Point, Size } from '../../shared/types'
import type { GmStore } from '../store'
import { placeMap } from './shared'

export interface MapSlice {
  /** The map image of the floor being viewed (see levelImages for the others). */
  mapImage: Blob | null
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
  setGrid(patch: Partial<GridSettings>): void
}

export const mapSlice: StateCreator<GmStore, [], [], MapSlice> = (set) => ({
  mapImage: null,
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
        hiddenAreas: [],
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
          sounds: s.scene.sounds?.map((x) => ({ ...x, ...turn(x) })),
          characters: s.scene.characters?.map((c) => ({ ...c, ...turn(c) })),
          hiddenAreas: (s.scene.hiddenAreas ?? []).flatMap((a) => {
            const shape = a.shape && turnHidden(a.shape, direction)
            const cells = turnHidden(a.cells, direction) ?? (shape && nothingHidden(shape))
            if (!cells) return []
            return [{ ...a, cells, ...(shape && { shape }) }]
          }),
          view: onTable ? turn(s.scene.view) : s.scene.view,
        },
        // What's been explored turns with the map it covers.
        fogMemory: s.fogMemory && turnFogMemory(s.fogMemory, direction),
        fogVersion: s.fogVersion + 1,
        wallDraft: [],
        doorDraft: null,
      }
    }),
  setGrid: (patch) =>
    set((s) => {
      const { grid, map } = s.scene
      const next = { ...grid, ...patch }
      // A grid-locked map follows grid changes so the two stay matched.
      const nextMap = map?.lockToGrid ? followGrid(map, grid, next) : map
      return { scene: { ...s.scene, grid: next, ...placeMap(s.scene, nextMap) } }
    }),
})
