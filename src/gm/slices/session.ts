/** The scene as a whole: new, open, saved; undo state, notices and the selection across kinds. */
import type { StateCreator } from 'zustand'
import { applyLevel } from '../../shared/levels'
import { migrateLevel, migrateScene } from '../../shared/migrate'
import type { SceneFile } from '../../shared/sceneFile'
import type { TableState } from '../../shared/types'
import { sameRef, type WallPointRef } from '../../shared/walls'
import type { GmStore } from '../store'
import { defaultScene, FIRST_LEVEL, firstLevel, TOOLS_OFF } from './shared'

export interface SessionSlice {
  /** Name of the open scene file, if it came from or was saved to one. */
  sceneName: string | null
  /** Changes since the scene was last saved to or opened from a file. */
  unsaved: boolean
  /** Replace the scene with one from a file. */
  loadScene(file: SceneFile, name: string): void
  /** Start over with an empty scene (calibration and the table stay as they are). */
  newScene(): void
  /** Whether there's anything to undo or redo (kept up to date by history.ts). */
  history: { canUndo: boolean; canRedo: boolean }
  /** Bumped when a different scene replaces this one, so its undo history is dropped. */
  historyEpoch: number
  /** The scene was just saved under this name. */
  markSaved(name: string): void
  markUnsaved(): void
  /** A brief message over the GM's map (id changes with each one, to show it afresh). */
  notice: { text: string; id: number } | null
  notify(text: string): void
  /** Box selection: these lights and wall points (added to the selection if `add`). */
  selectMany(lightIds: string[], wallPoints: WallPointRef[], add: boolean): void
  /** Delete everything selected: lights, wall points and objects. */
  deleteSelection(): void
}

export const sessionSlice: StateCreator<GmStore, [], [], SessionSlice & Pick<TableState, 'scene'>> = (set, get) => ({
  scene: defaultScene,
  sceneName: null,
  unsaved: false,
  loadScene: (file, name) => {
    set((s) => {
      const shared = migrateScene(file.scene)
      const levels = file.levels.map((l) => migrateLevel(l, shared))
      const viewed = levels.find((l) => l.id === file.levelId) ?? levels[0]
      const tableLevelId = levels.some((l) => l.id === file.tableLevelId) ? file.tableLevelId : viewed.id
      return {
        historyEpoch: s.historyEpoch + 1,
        levels,
        levelId: viewed.id,
        tableLevelId,
        scene: applyLevel(shared, viewed),
        levelImages: file.mapImages,
        levelFog: file.fogMemories,
        display: { ...s.display, orientation: file.orientation },
        mapImage: file.mapImages[viewed.id] ?? null,
        fogMemory: file.fogMemories[viewed.id] ?? null,
        fogVersion: s.fogVersion + 1,
        gmCamera: file.camera,
        cameraVersion: s.cameraVersion + 1,
        objectImages: file.objectImages,
        // A fresh start for the GM's tools.
        ...TOOLS_OFF,
      }
    })
    // After the scene change, which marks unsaved (see sync).
    set({ sceneName: name, unsaved: false })
  },
  newScene: () => {
    set((s) => ({
      scene: defaultScene,
      levels: [firstLevel(defaultScene)],
      levelId: FIRST_LEVEL,
      tableLevelId: FIRST_LEVEL,
      levelImages: {},
      levelFog: {},
      mapImage: null,
      fogMemory: null,
      fogVersion: s.fogVersion + 1,
      gmCamera: null,
      cameraVersion: s.cameraVersion + 1,
      historyEpoch: s.historyEpoch + 1,
      objectImages: {},
      ...TOOLS_OFF,
    }))
    // After the scene change, which marks unsaved (see sync).
    set({ sceneName: null, unsaved: false })
  },
  history: { canUndo: false, canRedo: false },
  historyEpoch: 0,
  markSaved: (sceneName) => set({ sceneName, unsaved: false }),
  markUnsaved: () => set({ unsaved: true }),
  notice: null,
  notify: (text) => set((s) => ({ notice: { text, id: (s.notice?.id ?? 0) + 1 } })),
  selectMany: (lightIds, wallPoints, add) =>
    set((s) => ({
      selectedObjectIds: add ? s.selectedObjectIds : [],
      selectedHiddenId: add ? s.selectedHiddenId : null,
      selectedLightIds: add ? [...new Set([...s.selectedLightIds, ...lightIds])] : lightIds,
      selectedWallPoints: add
        ? [...s.selectedWallPoints, ...wallPoints.filter((p) => !s.selectedWallPoints.some((r) => sameRef(r, p)))]
        : wallPoints,
    })),
  deleteSelection: () => {
    const { selectedLightIds, selectedWallPoints, selectedObjectIds, selectedHiddenId, removeHidden } = get()
    const { removeLights, deleteWallPoints, removeObjects } = get()
    if (selectedHiddenId) removeHidden(selectedHiddenId)
    if (selectedWallPoints.length) deleteWallPoints(selectedWallPoints)
    if (selectedLightIds.length) removeLights(selectedLightIds)
    if (selectedObjectIds.length) removeObjects(selectedObjectIds)
  },
})
