import type { Point, Scene } from './types'
import type { Wall } from './visibility'

/**
 * How what a door hid comes into view on the table when it's opened: at once ('none'),
 * fading in, or wiping outwards from the door.
 */
export type DoorEffect = 'none' | 'fade' | 'wipe'

export interface DoorReveal {
  effect: DoorEffect
  /** Seconds. */
  duration: number
}

/** All doors' reveal unless a door has its own (the scene's doorReveal, else this). */
export const DEFAULT_DOOR_REVEAL: DoorReveal = { effect: 'wipe', duration: 3 }

export const DOOR_EFFECTS: { value: DoorEffect; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'wipe', label: 'Wipe' },
]

/** The middle of a door (where its button sits, and its reveal starts). */
export function doorMiddle(points: Point[]): Point {
  const a = points[0]
  const b = points.at(-1)!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** A door's reveal: its own, or the scene's for all doors. */
export function doorReveal(scene: Pick<Scene, 'doorReveal'>, wall: Wall): DoorReveal {
  const reveal = wall.door?.reveal ?? scene.doorReveal ?? DEFAULT_DOOR_REVEAL
  // Ripple was dropped: doors saved with it wipe.
  return (reveal.effect as string) === 'ripple' ? { ...reveal, effect: 'wipe' } : reveal
}

/** The doors opened between two versions of the walls. */
export function openedDoors(before: Wall[], after: Wall[]): Wall[] {
  if (before === after) return []
  const wasOpen = new Map(before.filter((w) => w.door).map((w) => [w.id, w.door!.open]))
  return after.filter((w) => w.door?.open && wasOpen.get(w.id) === false)
}
