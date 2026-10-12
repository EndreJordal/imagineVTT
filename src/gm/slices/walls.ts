/** Walls and doors: building, editing and selecting their points. */
import type { StateCreator } from 'zustand'
import { mapNatural } from '../../shared/geometry'
import type { Point } from '../../shared/types'
import type { Wall } from '../../shared/visibility'
import { deleteWallPoints, makeDoor, moveWallPoints, sameRef, sameSpot, selectedSegment, type WallPointRef, withLinked } from '../../shared/walls'
import type { DoorReveal } from '../../shared/doors'
import type { GmStore } from '../store'

export interface WallsSlice {
  /** The door whose settings are open (right-click on its button; GM-only). */
  selectedDoorId: string | null
  selectDoor(id: string | null): void
  /** A door's own reveal effect, or (undefined) the one for all doors. */
  setDoorOwnReveal(id: string, reveal: DoorReveal | undefined): void
  /** The reveal effect for all doors without their own. */
  setDoorReveal(reveal: DoorReveal): void
  /** Selected wall points (GM-only). */
  selectedWallPoints: WallPointRef[]
  /** Points of the wall being drawn, not yet confirmed. */
  wallDraft: Point[]
  /** The first point of the door being placed. */
  doorDraft: Point | null
  addWallPoint(p: Point): void
  /** Take back the last point of the wall being drawn. */
  undoWallPoint(): void
  cancelWallDraft(): void
  /** Turn the drawn points into a wall (needs at least two). */
  confirmWallDraft(): void
  clearWalls(): void
  /**
   * Walls found on the map image (in its own pixels), placed where the map is. `replace`
   * removes the existing walls and doors first.
   */
  addDetectedWalls(walls: { points: Point[]; door?: boolean }[], replace: boolean): void
  /** In door mode: the first click starts a door, the second (on the same wall) makes it. */
  placeDoorPoint(p: Point): void
  cancelDoorDraft(): void
  toggleDoor(id: string): void
  /** Turn the wall segment between two selected neighbouring wall points into a door. */
  convertToDoor(refs: WallPointRef[]): void
  /** Select just this wall point (and the points linked with it). */
  selectWallPoint(ref: WallPointRef): void
  /** Add a wall point (and its linked points) to the selection, or take them out. */
  toggleWallPointSelected(ref: WallPointRef): void
  moveWallPoints(refs: WallPointRef[], dx: number, dy: number): void
  deleteWallPoints(refs: WallPointRef[]): void
}

export const wallsSlice: StateCreator<GmStore, [], [], WallsSlice> = (set) => ({
  selectedDoorId: null,
  selectDoor: (selectedDoorId) =>
    set({ selectedDoorId, selectedLightIds: [], selectedWallPoints: [], selectedObjectIds: [], selectedHiddenId: null }),
  setDoorOwnReveal: (id, reveal) =>
    set((s) => ({
      scene: {
        ...s.scene,
        walls: s.scene.walls.map((w) => (w.id === id && w.door ? { ...w, door: { open: w.door.open, ...(reveal && { reveal }) } } : w)),
      },
    })),
  setDoorReveal: (doorReveal) => set((s) => ({ scene: { ...s.scene, doorReveal } })),
  selectedWallPoints: [],
  wallDraft: [],
  doorDraft: null,
  addWallPoint: (p) =>
    set((s) => {
      const draft = s.wallDraft
      const last = draft.at(-1)
      if (last && sameSpot(last, p)) return s // a double click, not a new point
      // Back at the start of a shape: close it and finish the wall.
      if (draft.length >= 3 && sameSpot(draft[0], p)) {
        const wall: Wall = { id: crypto.randomUUID(), points: [...draft, { ...draft[0] }] }
        return { scene: { ...s.scene, walls: [...s.scene.walls, wall] }, wallDraft: [] }
      }
      return { wallDraft: [...draft, p] }
    }),
  undoWallPoint: () => set((s) => ({ wallDraft: s.wallDraft.slice(0, -1) })),
  cancelWallDraft: () => set({ wallDraft: [] }),
  confirmWallDraft: () =>
    set((s) => {
      if (s.wallDraft.length < 2) return { wallDraft: [] }
      const wall: Wall = { id: crypto.randomUUID(), points: s.wallDraft }
      return { scene: { ...s.scene, walls: [...s.scene.walls, wall] }, wallDraft: [] }
    }),
  clearWalls: () => set((s) => ({ scene: { ...s.scene, walls: [] }, wallDraft: [], selectedWallPoints: [] })),
  addDetectedWalls: (detected, replace) =>
    set((s) => {
      const map = s.scene.map
      if (!map) return s
      // Detected in the image as shown (turned), in its pixels.
      const kx = map.width / mapNatural(map).width
      const ky = map.height / mapNatural(map).height
      const added: Wall[] = detected.map((w) => ({
        id: crypto.randomUUID(),
        points: w.points.map((p) => ({ x: map.x + p.x * kx, y: map.y + p.y * ky })),
        ...(w.door && { door: { open: false } }),
      }))
      const walls = replace ? added : [...s.scene.walls, ...added]
      return { scene: { ...s.scene, walls }, selectedWallPoints: [], wallDraft: [] }
    }),
  placeDoorPoint: (p) =>
    set((s) => {
      const first = s.doorDraft
      if (!first) return { doorDraft: p }
      const walls = makeDoor(s.scene.walls, first, p, () => crypto.randomUUID())
      // Not on the same stretch of wall as the first point: start over from here.
      if (!walls) return { doorDraft: p }
      return { scene: { ...s.scene, walls }, doorDraft: null }
    }),
  cancelDoorDraft: () => set({ doorDraft: null }),
  toggleDoor: (id) =>
    set((s) => ({
      scene: {
        ...s.scene,
        walls: s.scene.walls.map((w) => (w.id === id && w.door ? { ...w, door: { open: !w.door.open } } : w)),
      },
    })),
  convertToDoor: (refs) =>
    set((s) => {
      const span = selectedSegment(s.scene.walls, refs)
      const walls = span && makeDoor(s.scene.walls, span.a, span.b, () => crypto.randomUUID())
      if (!walls) return s
      return { scene: { ...s.scene, walls }, selectedWallPoints: [] }
    }),
  selectWallPoint: (ref) =>
    set((s) => ({
      selectedWallPoints: withLinked(s.scene.walls, [ref]),
      selectedLightIds: [],
      selectedObjectIds: [],
      selectedHiddenId: null,
    })),
  toggleWallPointSelected: (ref) =>
    set((s) => {
      const group = withLinked(s.scene.walls, [ref])
      const selected = s.selectedWallPoints.some((r) => sameRef(r, ref))
      return {
        selectedWallPoints: selected
          ? s.selectedWallPoints.filter((r) => !group.some((g) => sameRef(g, r)))
          : [...s.selectedWallPoints, ...group.filter((g) => !s.selectedWallPoints.some((r) => sameRef(r, g)))],
      }
    }),
  moveWallPoints: (refs, dx, dy) =>
    set((s) => ({ scene: { ...s.scene, walls: moveWallPoints(s.scene.walls, refs, dx, dy) } })),
  deleteWallPoints: (refs) =>
    set((s) => ({
      // Linked points go together: deleting a corner deletes it from every wall meeting there.
      scene: {
        ...s.scene,
        walls: deleteWallPoints(s.scene.walls, withLinked(s.scene.walls, refs), () => crypto.randomUUID()),
      },
      // Indices shift when walls are cut, so the wall point selection is done with.
      selectedWallPoints: [],
    })),
})
