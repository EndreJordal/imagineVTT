/** How far night goes at darkness 1: the map keeps a little colour and light to stay readable. */
export const NIGHT_DESATURATION = 0.85
export const NIGHT_DIMMING = 0.75

/**
 * 4x5 colour matrix (row-major, as Pixi's ColorMatrixFilter takes it) for a day–night
 * darkness of 0..1: desaturate towards luminance, then dim. 0 is the identity.
 */
export function nightMatrix(darkness: number): number[] {
  const d = Math.min(1, Math.max(0, darkness))
  const s = 1 - NIGHT_DESATURATION * d // saturation kept
  const b = 1 - NIGHT_DIMMING * d // brightness kept
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
