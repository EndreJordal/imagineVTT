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
  /** Subtle moving effects over the pictures (every picture alike). */
  effects: CurtainEffects
}

export type CurtainEffect = 'smoke' | 'shimmer' | 'ink' | 'vignette' | 'grain' | 'dust' | 'embers' | 'rain'

/** Each effect on or off, with its strength (0..1); ink can be blood instead. */
export type CurtainEffects = Record<CurtainEffect, { on: boolean; amount: number }> & { blood: boolean }

export const CURTAIN_EFFECTS: { value: CurtainEffect; label: string; title: string }[] = [
  { value: 'smoke', label: 'Smoke', title: 'Slow wisps of mist drifting across the picture' },
  { value: 'shimmer', label: 'Shimmer', title: 'A faint heat-haze ripple, as through warm air or old glass' },
  { value: 'ink', label: 'Ink', title: 'Dots of ink that slowly appear, bleed outward and fade' },
  { value: 'vignette', label: 'Breathing edges', title: 'The edges darken and lighten slowly, like candlelight' },
  { value: 'grain', label: 'Film grain', title: 'Fine grain and a faint flicker, like an old projector' },
  { value: 'dust', label: 'Dust', title: 'Tiny specks floating slowly upward, catching the light' },
  { value: 'embers', label: 'Embers', title: 'Glowing sparks rising and flickering out' },
  { value: 'rain', label: 'Rain on glass', title: 'Drops running down, as if seen through a window' },
]

export const DEFAULT_CURTAIN: CurtainState = {
  down: false,
  imageId: null,
  transition: 'fade',
  duration: 1.5,
  fit: 'cover',
  slideshow: { on: false, interval: 10, ids: [] },
  effects: {
    smoke: { on: false, amount: 0.5 },
    shimmer: { on: false, amount: 0.5 },
    ink: { on: false, amount: 0.5 },
    vignette: { on: false, amount: 0.5 },
    grain: { on: false, amount: 0.5 },
    dust: { on: false, amount: 0.5 },
    embers: { on: false, amount: 0.5 },
    rain: { on: false, amount: 0.5 },
    blood: false,
  },
}

/** The pictures the slideshow cycles through: the chosen ones that still exist, in order. */
export function slideshowIds(state: CurtainState, images: { id: string }[]): string[] {
  const exist = new Set(images.map((i) => i.id))
  return state.slideshow.ids.filter((id) => exist.has(id))
}
