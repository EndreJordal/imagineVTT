import type { Point } from './types'

/**
 * Sound: effects and ambiences from the asset library, played to an output the GM picks
 * (the TV's speakers, say). Sounds placed on the map are heard by the party (their vision
 * tokens) within a range, louder closer; global sounds play at their own volume, mixed in the
 * toolbar's mixer; doors can sound when opened and closed.
 */

/** A sound's audio, kept with the scene (so it plays without the library). */
export interface SoundClip {
  name: string
  /** Seconds (the first take). */
  duration: number
  /** Ogg Vorbis takes of the sound: one is picked at random each time it plays. */
  takes: Blob[]
  /** An ambience: other clips (by key) layered, looping or repeating. No takes of its own. */
  layers?: AmbienceLayer[]
}

export interface AmbienceLayer {
  clip: string
  volume: number
  /** Seconds between plays (about: varied a little); 0 loops it. */
  every: number
}

/** Clips by key (the library path, e.g. "Fantasy/Sounds/Doors/Door open"). */
export type SoundClips = Record<string, SoundClip>

/** When a map sound that doesn't loop plays: on the GM's click, when the party comes in range, or both. */
export type SoundTrigger = 'manual' | 'enter' | 'both'

/** A sound placed on the map. */
export interface MapSound {
  id: string
  name: string
  clip: string
  x: number
  y: number
  /** 0..1 at its source. */
  volume: number
  /** How far it's heard, in squares (silent beyond; full volume at its source). */
  range: number
  enabled: boolean
  loop: boolean
  trigger: SoundTrigger
  /** Entering its range has played it: it won't again until re-armed. */
  spent?: boolean
  group?: string
}

/** A sound in the mixer: heard everywhere, at its own volume. */
export interface GlobalSound {
  id: string
  name: string
  clip: string
  volume: number
  loop: boolean
  /** A loop that's playing. */
  playing: boolean
}

/** The sounds doors make. */
export interface DoorSounds {
  open: string | null
  close: string | null
  volume: number
}

export const DEFAULT_DOOR_SOUNDS: DoorSounds = { open: null, close: null, volume: 0.8 }

/**
 * How loud a map sound is to listeners (vision tokens; the table view's middle if there are
 * none): 0 beyond its range, rising to 1 at its source (an ease, so it swells as you near).
 */
export function hearing(sound: Pick<MapSound, 'x' | 'y' | 'range'>, listeners: Point[], gridSize: number): number {
  const range = sound.range * gridSize
  if (range <= 0) return 0
  let best = 0
  for (const l of listeners) {
    const d = Math.hypot(l.x - sound.x, l.y - sound.y) / range
    if (d < 1) best = Math.max(best, (1 - d) * (1 - d))
  }
  return best
}

/** The clips a clip needs (itself, and an ambience's layers). */
export function clipsNeeded(key: string, clips: SoundClips): string[] {
  const clip = clips[key]
  return [key, ...(clip?.layers?.map((l) => l.clip) ?? [])]
}
