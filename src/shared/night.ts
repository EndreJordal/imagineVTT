/** How far night goes at darkness 1: almost black (5% brightness), so only light sources show. */
export const NIGHT_DESATURATION = 0.85
export const NIGHT_DIMMING = 0.95

/** Fog-of-war memory (explored, out of sight): greyscale at this brightness. */
export const MEMORY_BRIGHTNESS = 0.4

/**
 * 4x5 colour matrix (row-major, as Pixi's ColorMatrixFilter takes it): keep `saturation`
 * of the colour (desaturating towards luminance), then scale by `brightness`.
 */
export function colorMatrix(saturation: number, brightness: number): number[] {
  const s = saturation
  const b = brightness
  // Rec. 709 luminance weights.
  const [lr, lg, lb] = [0.2126, 0.7152, 0.0722]
  const row = (own: number) => [
    b * (lr * (1 - s) + (own === 0 ? s : 0)),
    b * (lg * (1 - s) + (own === 1 ? s : 0)),
    b * (lb * (1 - s) + (own === 2 ? s : 0)),
    0,
    0,
  ]
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0]
}

/** Colour matrix for a day–night darkness of 0..1: desaturate, then dim. 0 is the identity. */
export function nightMatrix(darkness: number): number[] {
  const d = Math.min(1, Math.max(0, darkness))
  return colorMatrix(1 - NIGHT_DESATURATION * d, 1 - NIGHT_DIMMING * d)
}

/** Colour matrix for explored-but-unseen fog memory: greyscale and dim. */
export function memoryMatrix(): number[] {
  return colorMatrix(0, MEMORY_BRIGHTNESS)
}
