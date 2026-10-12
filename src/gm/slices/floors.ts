/** Floors: the scene's levels, which one is viewed and which is on the table. */
import type { StateCreator } from 'zustand'
import type { FogMemory } from '../../shared/fog'
import { applyLevel, emptyLevel, type Level, moveParty } from '../../shared/levels'
import type { GmStore } from '../store'
import { allLevels, defaultScene, FIRST_LEVEL, firstLevel, TOOLS_OFF } from './shared'

export interface FloorsSlice {
  /**
   * The scene's floors, in order. `scene` holds the floor being viewed (levelId), so its
   * entry here is out of date while it's viewed: read floors through allLevels().
   */
  levels: Level[]
  /** The floor the GM views and edits, and the floor the table shows. */
  levelId: string
  tableLevelId: string
  /** Map images and fog memories of the floors not being viewed. */
  levelImages: Record<string, Blob | null>
  levelFog: Record<string, FogMemory | null>
  /** GM-only: the floor below shown faintly, to line maps up (stairs). */
  onionSkin: boolean
  /** View and edit another floor (the table keeps showing its floor). */
  viewLevel(id: string): void
  /** Show a floor on the table (default: the one viewed); the party goes along. */
  showLevelOnTable(id?: string): void
  /** Add an empty floor and view it. */
  addLevel(): void
  renameLevel(id: string, name: string): void
  moveLevel(id: string, by: -1 | 1): void
  deleteLevel(id: string): void
  setOnionSkin(on: boolean): void
}

export const floorsSlice: StateCreator<GmStore, [], [], FloorsSlice> = (set, get) => ({
  levels: [firstLevel(defaultScene)],
  levelId: FIRST_LEVEL,
  tableLevelId: FIRST_LEVEL,
  levelImages: {},
  levelFog: {},
  onionSkin: true,
  viewLevel: (id) =>
    set((s) => {
      if (id === s.levelId) return s
      const levels = allLevels(s)
      const target = levels.find((l) => l.id === id)
      if (!target) return s
      // The viewed floor's image and memory live in mapImage and fogMemory (not twice).
      const { [id]: _image, ...images } = s.levelImages
      const { [id]: _fog, ...fogs } = s.levelFog
      void _image
      void _fog
      return {
        levels,
        levelId: id,
        levelImages: { ...images, [s.levelId]: s.mapImage },
        levelFog: { ...fogs, [s.levelId]: s.fogMemory },
        scene: applyLevel(s.scene, target),
        mapImage: s.levelImages[id] ?? null,
        fogMemory: s.levelFog[id] ?? null,
        fogVersion: s.fogVersion + 1,
        ...TOOLS_OFF,
      }
    }),
  showLevelOnTable: (id) =>
    set((s) => {
      const to = id ?? s.levelId
      if (to === s.tableLevelId) return s
      const all = allLevels(s)
      const from = all.find((l) => l.id === s.tableLevelId)
      const target = all.find((l) => l.id === to)
      if (!target) return s
      // The party goes along to the floor shown, to the same place (floors line up).
      const moved = from ? moveParty(from.lights, target.lights) : null
      const levels = all.map((l) =>
        moved && l.id === from!.id ? { ...l, lights: moved.from } : moved && l.id === to ? { ...l, lights: moved.to } : l,
      )
      const viewed = levels.find((l) => l.id === s.levelId)!
      return { levels, tableLevelId: to, scene: applyLevel(s.scene, viewed) }
    }),
  addLevel: () => {
    const s = get()
    const level = emptyLevel(crypto.randomUUID(), `Floor ${s.levels.length + 1}`, s.scene)
    set({ levels: [...allLevels(s), level] })
    get().viewLevel(level.id)
  },
  renameLevel: (id, name) =>
    set((s) => ({ levels: s.levels.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) })),
  moveLevel: (id, by) =>
    set((s) => {
      const i = s.levels.findIndex((l) => l.id === id)
      const j = i + by
      if (i < 0 || j < 0 || j >= s.levels.length) return s
      const levels = [...s.levels]
      ;[levels[i], levels[j]] = [levels[j], levels[i]]
      return { levels }
    }),
  deleteLevel: (id) => {
    const s = get()
    const i = s.levels.findIndex((l) => l.id === id)
    if (i < 0 || s.levels.length <= 1) return
    const neighbour = s.levels[i === 0 ? 1 : i - 1].id
    if (s.tableLevelId === id) get().showLevelOnTable(neighbour)
    if (get().levelId === id) get().viewLevel(neighbour)
    set((t) => {
      const { [id]: _image, ...levelImages } = t.levelImages
      const { [id]: _fog, ...levelFog } = t.levelFog
      void _image
      void _fog
      return { levels: t.levels.filter((l) => l.id !== id), levelImages, levelFog }
    })
  },
  setOnionSkin: (onionSkin) => set({ onionSkin }),
})
