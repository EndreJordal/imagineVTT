/** What the store's slices share: defaults, the tools-off state, and helpers. */
import type { FogMemory } from '../../shared/fog'
import { carryPoint } from '../../shared/geometry'
import { extractLevel, type Level } from '../../shared/levels'
import { carryObject } from '../../shared/mapObjects'
import { DEFAULT_GRID_STYLE } from '../../shared/migrate'
import type { Display, MapInfo, Scene, Size } from '../../shared/types'
import type { Wall } from '../../shared/visibility'
import type { GmStore } from '../store'
import { SELECT } from '../tools'

export const MM_PER_INCH = 25.4

/** What each vision token last stamped into which memory grid (see stampFog). */
export const stamped = {
  memory: null as FogMemory | null,
  viewers: new Map<string, { key: string; walls: Wall[]; reveals: number }>(),
  /**
   * Counts reveals of hidden areas: then viewers that haven't moved may see (and remember)
   * more. Hiding more can't, so painting doesn't make them stamp again.
   */
  reveals: 0,
}

/** By default the GM sees half the darkness the players do. */
export const DEFAULT_GM_VISION = 0.5

export const defaultScene: Scene = {
  map: null,
  grid: { size: 100, offsetX: 0, offsetY: 0, visible: true, ...DEFAULT_GRID_STYLE },
  squareMm: MM_PER_INCH,
  view: { x: 2000, y: 1250 },
  darkness: 0,
  lights: [],
  fog: { mode: 'off', safety: true },
  walls: [],
  objects: [],
}

export const FIRST_LEVEL = 'floor-1'

export const firstLevel = (scene: Scene, id = FIRST_LEVEL): Level => extractLevel(scene, { id, name: 'Floor 1' })

/** Changing floor (or scene), or picking up a tool, starts the GM's tools afresh. */
export const TOOLS_OFF = {
  selectedLightIds: [],
  selectedWallPoints: [],
  selectedObjectIds: [],
  selectedHiddenId: null,
  tool: SELECT,
  wallDraft: [],
  doorDraft: null,
} satisfies Partial<GmStore>

/** All floors, up to date (the viewed one is read from the scene). */
export function allLevels(s: Pick<GmStore, 'levels' | 'levelId' | 'scene'>): Level[] {
  return s.levels.map((l) => (l.id === s.levelId ? extractLevel(s.scene, l) : l))
}

/** A floor's map image and fog memory. */
export function levelImage(s: Pick<GmStore, 'levelId' | 'mapImage' | 'levelImages'>, id: string): Blob | null {
  return id === s.levelId ? s.mapImage : (s.levelImages[id] ?? null)
}

export function levelFogMemory(s: Pick<GmStore, 'levelId' | 'fogMemory' | 'levelFog'>, id: string): FogMemory | null {
  return id === s.levelId ? s.fogMemory : (s.levelFog[id] ?? null)
}

// Calibrated on the GM's own table TV: the nominal 96 CSS px per inch square measured 137 mm
// instead of 100. Other screens differ; calibration corrects it.
export const defaultDisplay: Display = { pxPerMm: (96 / MM_PER_INCH) * (100 / 137), orientation: 0 }

// Until a table window has ever connected, assume a 1080p TV.
export const defaultTableScreen: Size = { width: 1920, height: 1080 }

/**
 * A new placement for the map, with the lights on it carried along so they stay on the
 * things drawn there. Lights travelling with the table view belong to the party, not the
 * map, so they stay put.
 */
export function placeMap(scene: Scene, map: MapInfo | null): Pick<Scene, 'map' | 'lights' | 'walls' | 'objects'> {
  const from = scene.map
  const unchanged =
    !from || !map || (from.x === map.x && from.y === map.y && from.width === map.width)
  if (unchanged) return { map, lights: scene.lights, walls: scene.walls, objects: scene.objects }
  return {
    // Objects are on the map: they move and scale with it.
    objects: scene.objects.map((o) => carryObject(o, from, map)),
    map,
    lights: scene.lights.map((l) => (l.followView ? l : { ...l, ...carryPoint(l, from, map) })),
    // Walls are drawn on the map, so they always go with it.
    walls: scene.walls.map((w) => ({ ...w, points: w.points.map((p) => carryPoint(p, from, map)) })),
  }
}
