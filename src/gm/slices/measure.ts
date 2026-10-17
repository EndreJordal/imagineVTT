/** Measuring: the settings, the measurement being drawn, and the ones kept on each floor. */
import type { StateCreator } from 'zustand'
import { MEASURE_COLORS, snapMeasure, type Measure, type MeasureDistance, type MeasureShape, type MeasureSnap } from '../../shared/measure'
import type { Point } from '../../shared/types'
import type { GmStore } from '../store'

/** The GM's measuring settings (kept between visits, not with the scene). */
export interface MeasureSettings {
  shape: MeasureShape
  /** Measurements stay after the button is let go (else only while it's held). */
  persist: boolean
  color: string
  snap: MeasureSnap
  distance: MeasureDistance
}

export const DEFAULT_MEASURE: MeasureSettings = {
  shape: 'line',
  persist: false,
  color: MEASURE_COLORS[0].color,
  snap: 'center',
  distance: 'grid',
}

export interface MeasureSlice {
  measure: MeasureSettings
  setMeasure(patch: Partial<MeasureSettings>): void
  /** The measurement being drawn (shown on the table too), until the button is let go. */
  measureDraft: Measure | null
  /** Start, extend or finish drawing at p (`free`: no snapping, Alt held). */
  measureStart(p: Point, free: boolean): void
  measureMove(p: Point, free: boolean): void
  measureEnd(): void
  removeMeasure(id: string): void
  /** Clear every kept measurement on the floor viewed. */
  clearMeasures(): void
}

export const measureSlice: StateCreator<GmStore, [], [], MeasureSlice> = (set, get) => {
  const at = (p: Point, free: boolean) => {
    const { measure, scene } = get()
    return measure.shape === 'free' || free ? { x: p.x, y: p.y } : snapMeasure(p, scene.grid, measure.snap)
  }
  return {
    measure: DEFAULT_MEASURE,
    setMeasure: (patch) => set((s) => ({ measure: { ...s.measure, ...patch } })),
    measureDraft: null,
    measureStart: (p, free) => {
      const { shape, color, distance } = get().measure
      const start = at(p, free)
      set({ measureDraft: { id: crypto.randomUUID(), shape, points: shape === 'free' ? [start] : [start, start], color, distance } })
    },
    measureMove: (p, free) =>
      set((s) => {
        const d = s.measureDraft
        if (!d) return s
        const to = at(p, free)
        if (d.shape !== 'free') return { measureDraft: { ...d, points: [d.points[0], to] } }
        // A stroke: a point every so often (a tenth of a square), not every pixel.
        const last = d.points[d.points.length - 1]
        if (Math.hypot(to.x - last.x, to.y - last.y) < s.scene.grid.size * 0.1) return s
        return { measureDraft: { ...d, points: [...d.points, to] } }
      }),
    measureEnd: () =>
      set((s) => {
        const d = s.measureDraft
        if (!d) return s
        const [a, b] = d.points
        const nothing = d.shape === 'free' ? false : !b || (a.x === b.x && a.y === b.y)
        if (!s.measure.persist || nothing) return { measureDraft: null }
        return { measureDraft: null, scene: { ...s.scene, measures: [...(s.scene.measures ?? []), d] } }
      }),
    removeMeasure: (id) =>
      set((s) => ({ scene: { ...s.scene, measures: (s.scene.measures ?? []).filter((m) => m.id !== id) } })),
    clearMeasures: () => set((s) => (s.scene.measures?.length ? { scene: { ...s.scene, measures: [] } } : s)),
  }
}
