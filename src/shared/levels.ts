import type { HiddenAreas } from './hidden'
import type { Light } from './lights'
import type { MapObject } from './mapObjects'
import type { GridSettings, MapInfo, Scene } from './types'
import type { Wall } from './visibility'

/**
 * A floor (level) of a scene: its own map, grid alignment, walls and doors, objects, fixed
 * lights, fog of war and time of day. One floor is shown on the table at a time.
 *
 * Shared by all floors: the table view (PVB), the physical square size, vision safety, and
 * the party: lights travelling with the PVB, which go along to whichever floor the table shows.
 */
export interface Level {
  id: string
  name: string
  map: MapInfo | null
  grid: GridSettings
  darkness: number
  /** Lights on this floor (the party's travel with the table view to the floor shown). */
  lights: Light[]
  fogEnabled: boolean
  walls: Wall[]
  objects: MapObject[]
  /** Hidden areas ("local fog"); absent in floors saved before them. */
  hidden?: HiddenAreas | null
}

/** A floor's part of a scene (the scene shows one floor; see applyLevel). */
export function extractLevel(scene: Scene, base: Pick<Level, 'id' | 'name'>): Level {
  return {
    id: base.id,
    name: base.name,
    map: scene.map,
    grid: scene.grid,
    darkness: scene.darkness,
    lights: scene.lights,
    fogEnabled: scene.fog.enabled,
    walls: scene.walls,
    objects: scene.objects,
    hidden: scene.hidden ?? null,
  }
}

/** The scene showing `level`, with the shared parts of `scene`. */
export function applyLevel(scene: Scene, level: Level): Scene {
  return {
    ...scene,
    map: level.map,
    grid: level.grid,
    darkness: level.darkness,
    lights: level.lights,
    fog: { ...scene.fog, enabled: level.fogEnabled },
    walls: level.walls,
    objects: level.objects,
    hidden: level.hidden ?? null,
  }
}

/** A new, empty floor, continuing the scene's grid size, time of day and fog setting. */
export function emptyLevel(id: string, name: string, like: Scene): Level {
  return {
    id,
    name,
    map: null,
    grid: { ...like.grid },
    darkness: like.darkness,
    lights: [],
    fogEnabled: like.fog.enabled,
    walls: [],
    objects: [],
    hidden: null,
  }
}

/** The party: lights that travel with the table view. */
export const isParty = (l: Light) => !!l.followView

/** Move the party from one floor's lights to another's (same places: floors line up). */
export function moveParty(from: Light[], to: Light[]): { from: Light[]; to: Light[] } {
  const party = from.filter(isParty)
  if (!party.length) return { from, to }
  return { from: from.filter((l) => !isParty(l)), to: [...to.filter((l) => !isParty(l)), ...party] }
}
