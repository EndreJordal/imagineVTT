import { legacyAreas, type HiddenMask } from './hidden'
import { applyLevel, extractLevel, type Level } from './levels'
import { DEFAULT_VISION_RANGE, LIGHT_PRESETS } from './lights'
import type { MapInfo, Scene, Size } from './types'

/** Grid line style for scenes that don't say (saved before it could be set). */
export const DEFAULT_GRID_STYLE = { color: '#ffffff', opacity: 0.35 }

/**
 * Fill in fields missing from scenes saved by earlier versions (in the session store or in
 * a scene file), so old saves keep opening.
 */
export function migrateScene(scene: Scene): Scene {
  scene.grid = { ...DEFAULT_GRID_STYLE, ...scene.grid }
  scene.darkness ??= 0
  scene.lights ??= []
  const fog: Partial<Scene['fog']> = scene.fog ?? {}
  scene.fog = { enabled: fog.enabled ?? false, safety: fog.safety ?? true }
  scene.walls ??= []
  scene.objects ??= []
  // Before areas, hidden areas were one mask with one softness.
  const legacy = scene as Scene & { hidden?: HiddenMask | null; hiddenSoftness?: number }
  if (!scene.hiddenAreas) scene.hiddenAreas = legacyAreas(legacy.hidden, legacy.hiddenSoftness)
  delete legacy.hidden
  delete legacy.hiddenSoftness
  for (const l of scene.lights) {
    l.vision ??= LIGHT_PRESETS[l.kind].handheld
    l.visionRange ??= DEFAULT_VISION_RANGE
  }
  const map = scene.map as (Partial<MapInfo> & Size) | null
  if (map) {
    map.naturalWidth ??= map.width
    map.naturalHeight ??= map.height
    map.x ??= 0
    map.y ??= 0
  }
  return scene
}

/** A floor saved by an earlier version: fill in what's missing, as for scenes. */
export function migrateLevel(level: Level, shared: Scene): Level {
  const old = level as Level & { hidden?: HiddenMask | null }
  const hiddenAreas = level.hiddenAreas ?? legacyAreas(old.hidden, (shared as { hiddenSoftness?: number }).hiddenSoftness)
  const scene = migrateScene(
    applyLevel(shared, { ...level, objects: level.objects ?? [], walls: level.walls ?? [], hiddenAreas }),
  )
  return extractLevel(scene, level)
}
