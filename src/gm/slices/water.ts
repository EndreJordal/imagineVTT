/** Water areas: painting them, and setting them up. */
import type { StateCreator } from 'zustand'
import { sceneBounds } from '../../shared/geometry'
import { encodeHidden, fillHidden, paintHidden, type FillResult } from '../../shared/hidden'
import { nextName } from '../../shared/names'
import type { Point } from '../../shared/types'
import { DEFAULT_WATER, waterAt, waterGrid, type WaterArea } from '../../shared/water'
import type { GmStore } from '../store'
import { selectOnly, SINGLES_OFF } from './shared'

/** The brush stroke being painted (by the id the canvas gives it) and the area it paints. */
const strokes = new Map<string, string>()

const newWater = (id: string, cells: WaterArea['cells'], areas: WaterArea[]): WaterArea => ({
  id,
  name: nextName('Water', areas.map((a) => a.name)),
  cells,
  ...DEFAULT_WATER,
})

export type WaterTool = 'brush' | 'erase' | 'fill'

export interface WaterSlice {
  /** The mode the water tool comes back in. */
  waterMode: WaterTool
  /** Water brush radius, in squares. */
  waterBrush: number
  setWaterBrush(squares: number): void
  /** Fill the space closed in by walls at p with water, or select the water already there. */
  waterFill(p: Point): FillResult | 'selected'
  /**
   * Brush stroke from `from` to `to`, painting water or (erase) taking it away. A stroke paints
   * one area: the one it starts on (so strokes that join it share its token), or a new one.
   */
  waterPaint(from: Point, to: Point, erase: boolean, stroke: string): void
  /** The water areas selected (GM-only): one for its panel, several to change together or group. */
  selectedWaterIds: string[]
  /** Select just this water (null: none). */
  selectWater(id: string | null): void
  /** A water area in or out of the selection (Shift+click). */
  toggleWaterSelected(id: string): void
  updateWater(id: string, patch: Partial<Omit<WaterArea, 'id' | 'cells'>>): void
  /** The same change to several water areas. */
  updateWaters(ids: string[], patch: Partial<Omit<WaterArea, 'id' | 'cells' | 'name'>>): void
  removeWater(id: string): void
}

export const waterSlice: StateCreator<GmStore, [], [], WaterSlice> = (set, get) => ({
  waterMode: 'brush',
  waterBrush: 1,
  setWaterBrush: (waterBrush) => set({ waterBrush }),
  waterFill: (p) => {
    const { scene, selectWater } = get()
    const bounds = sceneBounds(scene)
    const hit = waterAt(scene.waterAreas, bounds, p)
    if (hit) {
      selectWater(hit.id)
      return 'selected'
    }
    const grid = waterGrid(bounds)
    const result = fillHidden(grid, bounds, scene.walls, p)
    const cells = result === 'filled' && encodeHidden(grid.cols, grid.rows, grid.mask)
    if (cells) {
      const area = newWater(crypto.randomUUID(), cells, scene.waterAreas ?? [])
      set((s) => ({ scene: { ...s.scene, waterAreas: [...(s.scene.waterAreas ?? []), area] } }))
    }
    return result
  },
  waterPaint: (from, to, erase, stroke) =>
    set((s) => {
      const bounds = sceneBounds(s.scene)
      const radius = s.waterBrush * s.scene.grid.size
      const areas = s.scene.waterAreas ?? []
      if (erase) {
        // Erasing trims every area it touches; one erased away is gone.
        let changed = false
        const waterAreas = areas.flatMap((a) => {
          const grid = waterGrid(bounds, a)
          if (!paintHidden(grid, bounds, from, to, radius, 0)) return [a]
          changed = true
          const cells = encodeHidden(grid.cols, grid.rows, grid.mask)
          return cells ? [{ ...a, cells }] : []
        })
        if (!changed) return s
        const kept = new Set(waterAreas.map((a) => a.id))
        return { scene: { ...s.scene, waterAreas }, selectedWaterIds: s.selectedWaterIds.filter((id) => kept.has(id)) }
      }
      let id = strokes.get(stroke)
      if (!id) {
        strokes.clear() // a new stroke: the last one's done
        id = waterAt(areas, bounds, from)?.id ?? stroke
        strokes.set(stroke, id)
      }
      const area = areas.find((a) => a.id === id)
      const grid = waterGrid(bounds, area)
      if (!paintHidden(grid, bounds, from, to, radius, 1)) return s
      const cells = encodeHidden(grid.cols, grid.rows, grid.mask)!
      const waterAreas = area ? areas.map((a) => (a.id === id ? { ...a, cells } : a)) : [...areas, newWater(id, cells, areas)]
      return { scene: { ...s.scene, waterAreas } }
    }),
  selectedWaterIds: [],
  selectWater: (id) => set(selectOnly({ selectedWaterIds: id ? [id] : [] })),
  toggleWaterSelected: (id) =>
    set((s) => ({
      selectedWaterIds: s.selectedWaterIds.includes(id) ? s.selectedWaterIds.filter((x) => x !== id) : [...s.selectedWaterIds, id],
      ...SINGLES_OFF,
    })),
  updateWater: (id, patch) =>
    set((s) => ({
      scene: { ...s.scene, waterAreas: (s.scene.waterAreas ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) },
    })),
  updateWaters: (ids, patch) =>
    set((s) => {
      const chosen = new Set(ids)
      return { scene: { ...s.scene, waterAreas: (s.scene.waterAreas ?? []).map((a) => (chosen.has(a.id) ? { ...a, ...patch } : a)) } }
    }),
  removeWater: (id) =>
    set((s) => ({
      scene: { ...s.scene, waterAreas: (s.scene.waterAreas ?? []).filter((a) => a.id !== id) },
      selectedWaterIds: s.selectedWaterIds.filter((x) => x !== id),
    })),
})
