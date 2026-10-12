/** Hidden areas ("local fog"): hiding, setting up and revealing them. */
import type { StateCreator } from 'zustand'
import { sceneBounds } from '../../shared/geometry'
import { activeAreas, areaAt, areaRect, DEFAULT_HIDDEN_SOFTNESS, editableGrid, encodeHidden, fillHidden, type FillResult, type HiddenArea, type HiddenMask, inArea, paintHidden } from '../../shared/hidden'
import type { Light } from '../../shared/lights'
import type { Point } from '../../shared/types'
import type { GmStore } from '../store'
import type { HideTool } from '../tools'
import { stamped } from './shared'

/** The brush stroke being painted (by the id the canvas gives it) and the area it paints. */
const strokes = new Map<string, string>()

const newArea = (id: string, cells: HiddenMask): HiddenArea => ({
  id,
  cells,
  softness: DEFAULT_HIDDEN_SOFTNESS,
  revealWithVision: true,
})

export interface HiddenSlice {
  /** The mode the hide tool comes back in: the last one used. */
  hideMode: HideTool
  /** Hide brush radius, in squares. */
  hideBrush: number
  setHideBrush(squares: number): void
  /** Dropper: hide the enclosed space at p as a new area, or select the area already there. */
  hideFill(p: Point): FillResult | 'selected'
  /**
   * Brush stroke from `from` to `to`, hiding or (erase) revealing. A stroke (the canvas's
   * id for one press and drag) paints one area: the one it starts on, or a new one.
   */
  hidePaint(from: Point, to: Point, erase: boolean, stroke: string): void
  /** The hidden area whose token is selected (GM-only). */
  selectedHiddenId: string | null
  selectHidden(id: string | null): void
  updateHidden(id: string, patch: Partial<Pick<HiddenArea, 'softness' | 'revealWithVision' | 'active'>>): void
  /** Switch all hidden areas on the floor off (kept, not drawn) or back on. */
  setHiddenEnabled(on: boolean): void
  /** Remove an area: what it hid shows again. */
  removeHidden(id: string): void
  /** Reveal every hidden area on this floor. */
  revealAll(): void
  /**
   * The party walked in: remove each hidden area set to reveal with vision that a vision
   * token has entered since `before` (their earlier positions; null when they've just
   * arrived on this floor). Only on the floor the table shows.
   */
  revealEntered(before: Light[] | null): void
}

export const hiddenSlice: StateCreator<GmStore, [], [], HiddenSlice> = (set, get) => ({
  hideMode: 'fill',
  hideBrush: 1,
  setHideBrush: (hideBrush) => set({ hideBrush }),
  hideFill: (p) => {
    const { scene, selectHidden } = get()
    const bounds = sceneBounds(scene)
    const hit = areaAt(scene.hiddenAreas, bounds, p)
    if (hit) {
      selectHidden(hit.id)
      return 'selected'
    }
    const grid = editableGrid(bounds)
    const result = fillHidden(grid, bounds, scene.walls, p)
    const cells = result === 'filled' && encodeHidden(grid.cols, grid.rows, grid.mask)
    if (cells) {
      const area = newArea(crypto.randomUUID(), cells)
      set((s) => ({ scene: { ...s.scene, hiddenAreas: [...(s.scene.hiddenAreas ?? []), area] } }))
    }
    return result
  },
  hidePaint: (from, to, erase, stroke) =>
    set((s) => {
      const bounds = sceneBounds(s.scene)
      const radius = s.hideBrush * s.scene.grid.size
      const areas = s.scene.hiddenAreas ?? []
      if (erase) {
        // Erasing trims every area it touches; an area erased away is gone.
        let changed = false
        const reach = {
          x0: Math.min(from.x, to.x) - radius,
          y0: Math.min(from.y, to.y) - radius,
          x1: Math.max(from.x, to.x) + radius,
          y1: Math.max(from.y, to.y) + radius,
        }
        const hiddenAreas = areas.flatMap((a) => {
          const r = areaRect(a, bounds)
          if (r.x > reach.x1 || r.y > reach.y1 || r.x + r.width < reach.x0 || r.y + r.height < reach.y0) return [a]
          const grid = editableGrid(bounds, a.cells)
          if (!paintHidden(grid, bounds, from, to, radius, 0)) return [a]
          changed = true
          const cells = encodeHidden(grid.cols, grid.rows, grid.mask)
          return cells ? [{ ...a, cells }] : []
        })
        if (!changed) return s
        stamped.reveals++
        const selected = hiddenAreas.some((a) => a.id === s.selectedHiddenId) ? s.selectedHiddenId : null
        return { scene: { ...s.scene, hiddenAreas }, selectedHiddenId: selected }
      }
      let id = strokes.get(stroke)
      if (!id) {
        strokes.clear() // a new stroke: the last one's done
        id = areaAt(areas, bounds, from)?.id ?? stroke
        strokes.set(stroke, id)
      }
      const area = areas.find((a) => a.id === id)
      const grid = editableGrid(bounds, area?.cells)
      if (!paintHidden(grid, bounds, from, to, radius, 1)) return s
      const cells = encodeHidden(grid.cols, grid.rows, grid.mask)!
      const hiddenAreas = area
        ? areas.map((a) => (a.id === id ? { ...a, cells } : a))
        : [...areas, newArea(id, cells)]
      return { scene: { ...s.scene, hiddenAreas } }
    }),
  selectedHiddenId: null,
  selectHidden: (id) => set({ selectedHiddenId: id, selectedLightIds: [], selectedWallPoints: [], selectedObjectIds: [] }),
  updateHidden: (id, patch) =>
    set((s) => ({
      scene: { ...s.scene, hiddenAreas: (s.scene.hiddenAreas ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) },
    })),
  setHiddenEnabled: (hiddenEnabled) => {
    if (!hiddenEnabled) stamped.reveals++ // what they hid may be seen now
    set((s) => ({ scene: { ...s.scene, hiddenEnabled } }))
  },
  removeHidden: (id) =>
    set((s) => {
      stamped.reveals++
      return {
        scene: { ...s.scene, hiddenAreas: (s.scene.hiddenAreas ?? []).filter((a) => a.id !== id) },
        selectedHiddenId: s.selectedHiddenId === id ? null : s.selectedHiddenId,
      }
    }),
  revealAll: () =>
    set((s) => {
      if (!s.scene.hiddenAreas?.length) return s
      stamped.reveals++
      return { scene: { ...s.scene, hiddenAreas: [] }, selectedHiddenId: null }
    }),
  revealEntered: (before) =>
    set((s) => {
      const areas = s.scene.hiddenAreas ?? []
      const active = new Set(activeAreas(s.scene))
      if (!areas.some((a) => a.revealWithVision && active.has(a)) || s.levelId !== s.tableLevelId) return s
      const bounds = sceneBounds(s.scene)
      const was = new Map((before ?? []).map((l) => [l.id, l]))
      const viewers = s.scene.lights.filter((l) => l.vision)
      const entered = (a: HiddenArea) =>
        viewers.some((l) => {
          if (!inArea(a, bounds, l)) return false
          // Moving about inside an area (or one painted over where it stands) isn't entering it.
          const prev = was.get(l.id)
          return !(prev && prev.vision && inArea(a, bounds, prev))
        })
      const hiddenAreas = areas.filter((a) => !(a.revealWithVision && active.has(a) && entered(a)))
      if (hiddenAreas.length === areas.length) return s
      stamped.reveals++
      const selected = hiddenAreas.some((a) => a.id === s.selectedHiddenId) ? s.selectedHiddenId : null
      return { scene: { ...s.scene, hiddenAreas }, selectedHiddenId: selected }
    }),
})
