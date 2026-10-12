/** Objects placed from the asset library. */
import type { StateCreator } from 'zustand'
import { sceneBounds } from '../../shared/geometry'
import { activeAreas, inArea } from '../../shared/hidden'
import { objectCorners, type AssetImage, type AssetImages, type MapObject } from '../../shared/mapObjects'
import { createVisibilityTest, visibilityPolygon, wallSegments } from '../../shared/visibility'
import type { GmStore } from '../store'

export interface ObjectsSlice {
  /** Selected objects (GM-only). */
  selectedObjectIds: string[]
  /** Images of the assets placed as objects, by asset key; kept with the scene. */
  objectImages: AssetImages
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
  /**
   * Mark objects shown once seen as seen, where a vision token sees them now (their middle
   * or a corner, not under a hidden area). On the floor the table shows, while something is
   * obscured.
   */
  noticeObjects(): void
}

export const objectsSlice: StateCreator<GmStore, [], [], ObjectsSlice> = (set) => ({
  selectedObjectIds: [],
  objectImages: {},
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
    set({ selectedObjectIds: id ? [id] : [], selectedLightIds: [], selectedWallPoints: [], selectedHiddenId: null }),
  noticeObjects: () =>
    set((s) => {
      const { scene } = s
      if (scene.fog.mode === 'off' || s.levelId !== s.tableLevelId) return s
      const waiting = scene.objects.filter((o) => o.visibility === 'seen' && !o.seen)
      if (!waiting.length) return s
      const segments = wallSegments(scene.walls)
      const viewers = scene.lights
        .filter((l) => l.vision)
        .map((l) => {
          const range = l.visionRange * scene.grid.size
          const sees = segments.length ? createVisibilityTest(l, visibilityPolygon(l, range, segments)) : () => true
          return { at: l, range, sees }
        })
      if (!viewers.length) return s
      const bounds = sceneBounds(scene)
      const hidden = activeAreas(scene)
      const seen = (p: { x: number; y: number }) =>
        !hidden.some((a) => inArea(a, bounds, p)) &&
        viewers.some((v) => Math.hypot(p.x - v.at.x, p.y - v.at.y) <= v.range && v.sees(p))
      const found = new Set(waiting.filter((o) => [o, ...objectCorners(o)].some(seen)).map((o) => o.id))
      if (!found.size) return s
      return { scene: { ...scene, objects: scene.objects.map((o) => (found.has(o.id) ? { ...o, seen: true } : o)) } }
    }),
  reorderObject: (id, to) =>
    set((s) => {
      const o = s.scene.objects.find((x) => x.id === id)
      if (!o) return s
      const rest = s.scene.objects.filter((x) => x.id !== id)
      return { scene: { ...s.scene, objects: to === 'front' ? [...rest, o] : [o, ...rest] } }
    }),
})
