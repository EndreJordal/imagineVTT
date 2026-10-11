import { Texture } from 'pixi.js'

/**
 * Soft white light shapes, drawn once on a canvas. Lights are these, tinted and scaled.
 * Edges fade out smoothly to zero so nothing ends in a visible ring or line.
 */

const SIZE = 256

function texture(width: number, height: number, alpha: (x: number, y: number) => number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
      img.data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, alpha(x, y))))
    }
  }
  ctx.putImageData(img, 0, 0)
  return Texture.from(canvas)
}

/** Round falloff: bright core easing to nothing at the radius. Spans [-1, 1] across. */
function radialFalloff(r: number) {
  if (r >= 1) return 0
  return Math.pow(1 - r, 1.7)
}

let radial: Texture | null = null

/** Round light; the texture's half-width is the light's radius. */
export function radialTexture(): Texture {
  radial ??= texture(SIZE, SIZE, (x, y) => {
    const dx = (x + 0.5) / (SIZE / 2) - 1
    const dy = (y + 0.5) / (SIZE / 2) - 1
    return radialFalloff(Math.hypot(dx, dy))
  })
  return radial
}

let cone: Texture | null = null

/**
 * Flashlight beam pointing right from the left-middle edge. Its width is the radius, and it
 * is drawn for a 45° half-angle (height = 2 × radius); scale y by tan(halfAngle) for others.
 * The angular falloff is a wide Gaussian and the length falls off gently, so the beam has
 * no hard edge anywhere.
 */
export function coneTexture(): Texture {
  cone ??= texture(SIZE * 2, SIZE * 2, (x, y) => {
    const px = (x + 0.5) / (SIZE * 2) // 0..1 along the beam
    const py = ((y + 0.5) / SIZE - 1) // -1..1 across
    const d = Math.hypot(px, py)
    if (d >= 1 || px <= 0) return 0
    const u = Math.atan2(Math.abs(py), px) / (Math.PI / 4) // 1 at the nominal edge
    const across = Math.exp(-3 * u * u)
    // A beam carries: near-full strength for the first third, then an S-curve to zero (zero
    // slope at the end, so no visible edge). Ramps in over the first bit so the lens isn't a
    // hard point.
    const along = (1 - smoothstep(0.3, 1, d)) * smoothstep(0, 0.1, d)
    return across * along
  })
  return cone
}

function smoothstep(a: number, b: number, v: number) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
