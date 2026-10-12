/**
 * The GM's store, put together from slices (src/gm/slices/), one per part of the work: floors,
 * tools, hidden areas, walls, lights, objects, map, fog, the table view, the session and groups.
 */
import { create } from 'zustand'
import type { FogMemory } from '../shared/fog'
import { applyLevel, type Level } from '../shared/levels'
import type { AssetImages } from '../shared/mapObjects'
import { migrateLevel, migrateScene } from '../shared/migrate'
import { load } from '../shared/persist'
import type { GmCamera } from '../shared/sceneFile'
import type { SoundClips } from '../shared/sound'
import type { Display, Scene, Size, TableState } from '../shared/types'
import { type FloorsSlice, floorsSlice } from './slices/floors'
import { audioSlice, type AudioSlice } from './slices/audio'
import { fogSlice, type FogSlice } from './slices/fog'
import { groupsSlice, type GroupsSlice } from './slices/groups'
import { type HiddenSlice, hiddenSlice } from './slices/hidden'
import { type LightsSlice, lightsSlice } from './slices/lights'
import { mapSlice, type MapSlice } from './slices/map'
import { type ObjectsSlice, objectsSlice } from './slices/objects'
import { type SessionSlice, sessionSlice } from './slices/session'
import { DEFAULT_GM_VISION, defaultDisplay, defaultScene, defaultTableScreen, firstLevel } from './slices/shared'
import { toolsSlice, type ToolsSlice } from './slices/tools'
import { type ViewSlice, viewSlice } from './slices/view'
import { wallsSlice, type WallsSlice } from './slices/walls'

export { allLevels, levelFogMemory, levelImage, MM_PER_INCH } from './slices/shared'

/** How dark the GM's own view is, given the table's darkness and the GM's vision. */
export function gmDarkness(s: Pick<GmStore, 'scene' | 'gmVision' | 'peeking'>): number {
  return s.peeking ? s.scene.darkness : s.scene.darkness * (1 - s.gmVision)
}

/** The GM window's state: the scene, and everything about how the GM works on it. */
export interface GmStore
  extends TableState,
    FloorsSlice,
    ToolsSlice,
    HiddenSlice,
    WallsSlice,
    LightsSlice,
    ObjectsSlice,
    MapSlice,
    FogSlice,
    ViewSlice,
    SessionSlice,
    GroupsSlice,
    AudioSlice {}

export const useGm = create<GmStore>()((...a) => ({
  ...floorsSlice(...a),
  ...toolsSlice(...a),
  ...hiddenSlice(...a),
  ...wallsSlice(...a),
  ...lightsSlice(...a),
  ...objectsSlice(...a),
  ...mapSlice(...a),
  ...fogSlice(...a),
  ...viewSlice(...a),
  ...sessionSlice(...a),
  ...groupsSlice(...a),
  ...audioSlice(...a),
}))

/** What the table shows: its floor, with the shared parts of the scene. */
export function tableState(s: GmStore): TableState {
  const level = s.tableLevelId === s.levelId ? null : s.levels.find((l) => l.id === s.tableLevelId)
  return { scene: level ? applyLevel(s.scene, level) : s.scene, display: s.display, calibrating: s.calibrating }
}

/** The floors, as kept between sessions (the viewed floor is in the saved scene). */
export interface SavedFloors {
  levels: Level[]
  levelId: string
  tableLevelId: string
  levelImages: Record<string, Blob | null>
  levelFog: Record<string, FogMemory | null>
}

/** Restore the last session from IndexedDB. */
export async function hydrate() {
  const [scene, display, mapImage, tableScreen, gmVision, fogMemory, gmCamera, sceneName, objectImages, floors, sound] =
    await Promise.all([
      load<Scene>('scene'),
      load<Display>('display'),
      load<Blob | null>('mapImage'),
      load<Size>('tableScreen'),
      load<number>('gmVision'),
      load<FogMemory>('fogMemory'),
      load<GmCamera>('gmCamera'),
      load<{ name: string | null; unsaved: boolean }>('sceneName'),
      load<AssetImages>('objectImages'),
      load<SavedFloors>('floors'),
      load<{ clips: SoundClips; master: number; output: string }>('sound'),
    ])
  const restored = scene ? migrateScene(scene) : defaultScene
  // Sessions from before floors: the scene is the one floor.
  const valid = floors?.levels.some((l) => l.id === floors.levelId)
  const levels = valid ? floors!.levels.map((l) => migrateLevel(l, restored)) : [firstLevel(restored)]
  const levelId = valid ? floors!.levelId : levels[0].id
  const tableLevelId = valid && levels.some((l) => l.id === floors!.tableLevelId) ? floors!.tableLevelId : levelId
  useGm.setState((s) => ({
    scene: restored,
    levels,
    levelId,
    tableLevelId,
    levelImages: (valid && floors!.levelImages) || {},
    levelFog: (valid && floors!.levelFog) || {},
    display: display ?? defaultDisplay,
    mapImage: mapImage ?? null,
    tableScreen: tableScreen ?? defaultTableScreen,
    gmVision: gmVision ?? DEFAULT_GM_VISION,
    fogMemory: fogMemory ?? null,
    gmCamera: gmCamera ?? null,
    objectImages: objectImages ?? {},
    soundClips: sound?.clips ?? {},
    masterVolume: sound?.master ?? 0.8,
    audioOutput: sound?.output ?? '',
    cameraVersion: s.cameraVersion + 1,
    sceneName: sceneName?.name ?? null,
    unsaved: sceneName?.unsaved ?? false,
  }))
}
