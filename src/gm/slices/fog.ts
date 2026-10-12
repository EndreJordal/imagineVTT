/** Fog of war: what the party has explored, and vision safety. */
import type { StateCreator } from 'zustand'
import { createFogMemory, fitsBounds, type FogMemory, stampVision } from '../../shared/fog'
import { boundingRect, sceneBounds } from '../../shared/geometry'
import { activeAreas, unionMask } from '../../shared/hidden'
import { createVisibilityTest, visibilityPolygon, wallSegments } from '../../shared/visibility'
import type { FogMode } from '../../shared/types'
import type { GmStore } from '../store'
import { stamped } from './shared'

export interface FogSlice {
  /**
   * What the party has seen under fog of war. The grid is updated in place, so fogVersion
   * changes whenever it does (that is what subscribers watch).
   */
  fogMemory: FogMemory | null
  fogVersion: number
  /** Record what vision tokens see now into fog memory (when fog is on). */
  stampFog(): void
  /** Forget everything the party has seen. */
  resetFog(): void
  /** Fog of war off, dimming what's out of sight, or full (see FogMode). */
  setFogMode(mode: FogMode): void
  setVisionSafety(on: boolean): void
}

export const fogSlice: StateCreator<GmStore, [], [], FogSlice> = (set, get) => ({
  fogMemory: null,
  fogVersion: 0,
  stampFog: () =>
    set((s) => {
      // The party explores the floor the table shows.
      // The party explores the floor the table shows, under full fog of war.
      if (s.scene.fog.mode !== 'full' || s.levelId !== s.tableLevelId) return s
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
          const { walls } = s.scene
          if (last && last.key === key && last.walls === walls && last.reveals === stamped.reveals) return false
          stamped.viewers.set(l.id, { key, walls, reveals: stamped.reveals })
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
      const hidden = unionMask(activeAreas(s.scene), bounds)
      const changed = viewers.length > 0 && stampVision(memory, bounds, viewers, hidden)
      if (!changed && memory === s.fogMemory) return s
      return { fogMemory: memory, fogVersion: s.fogVersion + 1 }
    }),
  resetFog: () => {
    set((s) => ({
      fogMemory: createFogMemory(sceneBounds(s.scene)),
      fogVersion: s.fogVersion + 1,
      // Objects shown once seen are unseen again too.
      scene: { ...s.scene, objects: s.scene.objects.map((o) => (o.seen ? { ...o, seen: false } : o)) },
    }))
    get().stampFog()
    get().noticeObjects()
  },
  setFogMode: (mode) => {
    set((s) => ({ scene: { ...s.scene, fog: { ...s.scene.fog, mode } } }))
    get().stampFog()
  },
  setVisionSafety: (safety) => set((s) => ({ scene: { ...s.scene, fog: { ...s.scene.fog, safety } } })),
})
