/** Objects placed from the asset library. */
import type { StateCreator } from 'zustand'
import type { AssetImage, AssetImages, MapObject } from '../../shared/mapObjects'
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
  reorderObject: (id, to) =>
    set((s) => {
      const o = s.scene.objects.find((x) => x.id === id)
      if (!o) return s
      const rest = s.scene.objects.filter((x) => x.id !== id)
      return { scene: { ...s.scene, objects: to === 'front' ? [...rest, o] : [o, ...rest] } }
    }),
})
