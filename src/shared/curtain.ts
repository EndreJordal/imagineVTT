/**
 * The curtain: a picture shown on the table instead of the map (a title card, a scene
 * illustration, "we'll be right back"), dropped and raised by the GM. Only the table shows
 * it; the GM's view keeps the map, with the table view's outline marking the curtain down.
 *
 * Its pictures (a folder on the GM's computer) and settings belong to the GM, not to a
 * scene: they stay across scenes.
 */

/** How the table goes from one picture to the next (or from the map to a picture). */
export type CurtainTransition = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'iris'

export const CURTAIN_TRANSITIONS: { value: CurtainTransition; label: string }[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'iris', label: 'Iris' },
]

export interface CurtainState {
  down: boolean
  /** The picture shown (outside a slideshow). */
  imageId: string | null
  transition: CurtainTransition
  /** Transition time, in seconds. */
  duration: number
  /** Fill the screen (cropping), or show the whole picture (with black bars). */
  fit: 'cover' | 'contain'
  /** Cycle through `ids` every `interval` seconds while the curtain is down. */
  slideshow: { on: boolean; interval: number; ids: string[] }
}

export const DEFAULT_CURTAIN: CurtainState = {
  down: false,
  imageId: null,
  transition: 'fade',
  duration: 1.5,
  fit: 'cover',
  slideshow: { on: false, interval: 10, ids: [] },
}

/** The pictures the slideshow cycles through: the chosen ones that still exist, in order. */
export function slideshowIds(state: CurtainState, images: { id: string }[]): string[] {
  const exist = new Set(images.map((i) => i.id))
  return state.slideshow.ids.filter((id) => exist.has(id))
}
