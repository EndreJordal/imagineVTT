/**
 * Night and fog memory, as the map shader draws them. How far night goes at darkness 1:
 * almost black (5% brightness), so only light sources show.
 */
export const NIGHT_DESATURATION = 0.85
export const NIGHT_DIMMING = 0.95

/** Fog-of-war memory (explored, out of sight): greyscale at this brightness. */
export const MEMORY_BRIGHTNESS = 0.4
