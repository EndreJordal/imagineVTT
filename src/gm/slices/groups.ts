/** Named groups of lights, objects and hidden areas, selected and moved together. */
import type { StateCreator } from 'zustand'
import { isParty } from '../../shared/levels'
import { nextName } from '../../shared/names'
import type { Scene } from '../../shared/types'
import type { GmStore } from '../store'

/** What's in a group on the scene. */
export function groupMembers(scene: Scene, id: string) {
  return {
    lights: scene.lights.filter((l) => l.group === id),
    objects: scene.objects.filter((o) => o.group === id),
    hidden: (scene.hiddenAreas ?? []).filter((a) => a.group === id),
  }
}

/** The groups with anything in them (a group emptied by removals isn't shown). */
export function liveGroups(scene: Scene) {
  const used = new Set([...scene.lights, ...scene.objects, ...(scene.hiddenAreas ?? [])].map((x) => x.group))
  return (scene.groups ?? []).filter((g) => used.has(g.id))
}

export interface GroupsSlice {
  /**
   * Group what's selected (objects, lights but the party's, the selected hidden area) under a
   * new name; they leave any group they were in. The group becomes the selection.
   */
  groupSelection(): void
  /** Dissolve a group: its members stay, ungrouped. */
  ungroup(id: string): void
  renameGroup(id: string, name: string): void
  /** Select a group's objects and lights (hidden areas don't move, so stay unselected). */
  selectGroup(id: string): void
}

export const groupsSlice: StateCreator<GmStore, [], [], GroupsSlice> = (set, get) => ({
  groupSelection: () =>
    set((s) => {
      const lights = new Set(s.selectedLightIds.filter((id) => !isParty(s.scene.lights.find((l) => l.id === id)!)))
      const objects = new Set(s.selectedObjectIds)
      const hidden = s.selectedHiddenId
      if (lights.size + objects.size + (hidden ? 1 : 0) < 2) return s
      const scene = s.scene
      const groups = liveGroups(scene)
      const id = crypto.randomUUID()
      const name = nextName('Group', groups.map((g) => g.name))
      return {
        scene: {
          ...scene,
          groups: [...groups, { id, name }],
          lights: scene.lights.map((l) => (lights.has(l.id) ? { ...l, group: id } : l)),
          objects: scene.objects.map((o) => (objects.has(o.id) ? { ...o, group: id } : o)),
          hiddenAreas: (scene.hiddenAreas ?? []).map((a) => (a.id === hidden ? { ...a, group: id } : a)),
        },
      }
    }),
  ungroup: (id) =>
    set((s) => {
      const scene = s.scene
      const out = <T extends { group?: string }>(x: T): T => (x.group === id ? { ...x, group: undefined } : x)
      return {
        scene: {
          ...scene,
          groups: (scene.groups ?? []).filter((g) => g.id !== id),
          lights: scene.lights.map(out),
          objects: scene.objects.map(out),
          hiddenAreas: (scene.hiddenAreas ?? []).map(out),
        },
      }
    }),
  renameGroup: (id, name) =>
    set((s) => ({ scene: { ...s.scene, groups: (s.scene.groups ?? []).map((g) => (g.id === id ? { ...g, name } : g)) } })),
  selectGroup: (id) => {
    const { lights, objects } = groupMembers(get().scene, id)
    set({
      selectedLightIds: lights.map((l) => l.id),
      selectedObjectIds: objects.map((o) => o.id),
      selectedWallPoints: [],
      selectedHiddenId: null,
      selectedDoorId: null,
    })
  },
})
