/** Objects placed from the asset library. */
import type { StateCreator } from 'zustand'
import { sceneBounds } from '../../shared/geometry'
import { activeAreas, inArea } from '../../shared/hidden'
import { objectCorners, type AssetImage, type AssetImages, type MapObject } from '../../shared/mapObjects'
import { baseName, nextName } from '../../shared/names'
import type { Point } from '../../shared/types'
import type { GmStore } from '../store'
import { seersOf, selectOnly, SINGLES_OFF } from './shared'

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
  /** Change several objects; a function patch can tailor the change to each. */
  updateObjects(ids: string[], patch: Partial<Omit<MapObject, 'id'>> | ((o: MapObject) => Partial<Omit<MapObject, 'id'>>)): void
  /** Move several objects together. */
  moveObjects(ids: string[], dx: number, dy: number): void
  /** Add an object to the selection, or take it out (Shift+click). */
  toggleObjectSelected(id: string): void
  removeObjects(ids: string[]): void
  /** Select just this object (or nothing at all). */
  selectObject(id: string | null): void
  /** A copy of an object (same settings) centred at p; the copy becomes the selection. */
  copyObject(id: string, p: Point): void
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
      const name = nextName(baseName(object.name), s.scene.objects.map((o) => o.name), true)
      const placed: MapObject = { ...object, name, id: crypto.randomUUID() }
      return {
        scene: { ...s.scene, objects: [...s.scene.objects, placed] },
        ...selectOnly({ selectedObjectIds: [placed.id] }),
      }
    }),
  updateObject: (id, patch) =>
    set((s) => ({
      scene: { ...s.scene, objects: s.scene.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) },
    })),
  updateObjects: (ids, patch) =>
    set((s) => {
      const chosen = new Set(ids)
      const objects = s.scene.objects.map((o) =>
        chosen.has(o.id) ? { ...o, ...(typeof patch === 'function' ? patch(o) : patch) } : o,
      )
      return { scene: { ...s.scene, objects } }
    }),
  moveObjects: (ids, dx, dy) =>
    set((s) => {
      const chosen = new Set(ids)
      const objects = s.scene.objects.map((o) => (chosen.has(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o))
      return { scene: { ...s.scene, objects } }
    }),
  toggleObjectSelected: (id) =>
    set((s) => ({
      selectedObjectIds: s.selectedObjectIds.includes(id)
        ? s.selectedObjectIds.filter((x) => x !== id)
        : [...s.selectedObjectIds, id],
      ...SINGLES_OFF,
    })),
  removeObjects: (ids) =>
    set((s) => {
      const gone = new Set(ids)
      return {
        scene: { ...s.scene, objects: s.scene.objects.filter((o) => !gone.has(o.id)) },
        selectedObjectIds: s.selectedObjectIds.filter((id) => !gone.has(id)),
      }
    }),
  selectObject: (id) => set(selectOnly({ selectedObjectIds: id ? [id] : [] })),
  noticeObjects: () =>
    set((s) => {
      const { scene } = s
      if (scene.fog.mode === 'off' || s.levelId !== s.tableLevelId) return s
      const waiting = scene.objects.filter((o) => o.visibility === 'seen' && !o.seen)
      if (!waiting.length) return s
      const viewers = seersOf(scene)
      if (!viewers.length) return s
      const bounds = sceneBounds(scene)
      const hidden = activeAreas(scene)
      const seen = (p: { x: number; y: number }) =>
        !hidden.some((a) => inArea(a, bounds, p)) &&
        viewers.some((v) => Math.hypot(p.x - v.x, p.y - v.y) <= v.range && v.sees(p))
      const found = new Set(waiting.filter((o) => [o, ...objectCorners(o)].some(seen)).map((o) => o.id))
      if (!found.size) return s
      return { scene: { ...scene, objects: scene.objects.map((o) => (found.has(o.id) ? { ...o, seen: true } : o)) } }
    }),
  copyObject: (id, p) =>
    set((s) => {
      const o = s.scene.objects.find((x) => x.id === id)
      if (!o) return s
      // A copy shown once seen hasn't been seen yet; one the GM revealed stays as it is.
      const name = nextName(baseName(o.name), s.scene.objects.map((x) => x.name), true)
      // Same settings; not in the original's group.
      const copy: MapObject = {
        ...o,
        name,
        group: undefined,
        id: crypto.randomUUID(),
        x: p.x,
        y: p.y,
        ...(o.visibility === 'seen' && { seen: false }),
      }
      return { scene: { ...s.scene, objects: [...s.scene.objects, copy] }, selectedObjectIds: [copy.id] }
    }),
  reorderObject: (id, to) =>
    set((s) => {
      const o = s.scene.objects.find((x) => x.id === id)
      if (!o) return s
      const rest = s.scene.objects.filter((x) => x.id !== id)
      return { scene: { ...s.scene, objects: to === 'front' ? [...rest, o] : [o, ...rest] } }
    }),
})
