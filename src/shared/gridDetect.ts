/**
 * Automatic detection of a square grid drawn on a battlemap image.
 *
 * 1. Per axis, build a 1D profile of thin-line evidence per column (or row), using a ridge
 *    test that ignores edges in the art (see lineProfile). Long straight grid lines add up
 *    over the whole map; art strokes don't.
 * 2. Fold each profile modulo candidate periods. At the true period every grid line lands
 *    in the same phase bin and makes a peak; the score is that peak's signal-to-noise
 *    ratio, which also favours the true period over its multiples and fractions. Both axes
 *    are scored together since cells are square.
 * 3. Refine period and phase to sub-pixel precision, and snap to a whole number of cells
 *    across the image when that fits as well (maps are usually exported that way).
 *
 * Large images are searched at reduced size, then refined at full resolution.
 */

export interface GrayImage {
  width: number
  height: number
  /** Luminance 0..1, row-major. */
  data: Float32Array
}

export type Polarity = 'dark' | 'light'

export interface GridDetection {
  /** Cell size in image pixels. */
  period: number
  /** Image-pixel position of a vertical / horizontal grid line, in [0, period). */
  phaseX: number
  phaseY: number
  /** Signal-to-noise ratio of the grid lines; see MIN_CONFIDENCE. */
  confidence: number
  /** Whether the grid lines are darker or lighter than the map. */
  polarity: Polarity
}

export interface DetectOptions {
  /** Smallest / largest cell size to consider, in image pixels. */
  minPeriod?: number
  maxPeriod?: number
  /** Receives a trace of the search's decisions, for tuning. */
  log?: (message: string) => void
}

/** Below this confidence the result should be treated as "no grid found". */
export const MIN_CONFIDENCE = 8

/** Images larger than this (longest side) are searched at reduced size. */
const SEARCH_SIZE = 2048

export function toGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const data = new Float32Array(width * height)
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255
  }
  return { width, height, data }
}

export function detectGrid(img: GrayImage, options: DetectOptions = {}): GridDetection | null {
  const log = options.log ?? (() => {})
  const minPeriod = options.minPeriod ?? 12
  const maxPeriod = Math.min(options.maxPeriod ?? 400, Math.min(img.width, img.height) / 3)
  if (maxPeriod <= minPeriod) return null

  // Search at reduced size: an integer factor keeps the maths simple, and lines survive
  // box-averaging as fainter lines, which the ridge test still picks up.
  const factor = Math.max(1, Math.floor(Math.max(img.width, img.height) / SEARCH_SIZE))
  const small = factor > 1 ? downscale(img, factor) : img
  log(`search at 1/${factor}: ${small.width}x${small.height}`)

  // Grid lines are either darker or lighter than the map; try both and keep the clearer.
  let found: { polarity: Polarity; period: number; score: number } | null = null
  for (const polarity of ['dark', 'light'] as const) {
    const profiles = Profiles.of(small, polarity)
    const period = profiles.search(Math.max(6, minPeriod / factor), maxPeriod / factor)
    const { score } = profiles.refine(period)
    log(`${polarity}: period ${(period * factor).toFixed(3)} score ${score.toFixed(1)}`)
    if (!found || score > found.score) found = { polarity, period: period * factor, score }
  }
  if (!found) return null

  // Final period and phase from full-resolution profiles.
  const full = factor > 1 ? Profiles.of(img, found.polarity) : Profiles.of(small, found.polarity)
  let result = full.refine(found.period, factor)
  result = full.snapToWholeCells(result, img)
  log(`final: period ${result.p.toFixed(3)} score ${result.score.toFixed(1)}`)

  return {
    period: result.p,
    phaseX: result.fx.phase,
    phaseY: result.fy.phase,
    confidence: result.score,
    polarity: found.polarity,
  }
}

/** Average factor×factor blocks. */
function downscale(img: GrayImage, factor: number): GrayImage {
  const width = Math.floor(img.width / factor)
  const height = Math.floor(img.height / factor)
  const data = new Float32Array(width * height)
  const norm = 1 / (factor * factor)
  for (let y = 0; y < height; y++) {
    for (let dy = 0; dy < factor; dy++) {
      const row = (y * factor + dy) * img.width
      for (let x = 0; x < width; x++) {
        let sum = 0
        const start = row + x * factor
        for (let dx = 0; dx < factor; dx++) sum += img.data[start + dx]
        data[y * width + x] += sum * norm
      }
    }
  }
  return { width, height, data }
}

interface Candidate {
  p: number
  score: number
  fx: Fold
  fy: Fold
}

/** Line profiles of one image for one polarity, with the period search over them. */
class Profiles {
  readonly x: Float64Array
  readonly y: Float64Array
  private sigmaX: number
  private sigmaY: number
  private longest: number

  private constructor(x: Float64Array, y: Float64Array) {
    this.x = x
    this.y = y
    this.sigmaX = stdDev(x)
    this.sigmaY = stdDev(y)
    this.longest = Math.max(x.length, y.length)
  }

  static of(img: GrayImage, polarity: Polarity) {
    return new Profiles(lineProfile(img, 'x', polarity), lineProfile(img, 'y', polarity))
  }

  score(p: number, x = this.x, y = this.y): Candidate {
    const fx = foldScore(x, p, this.sigmaX)
    const fy = foldScore(y, p, this.sigmaY)
    return { p, score: (fx.score + fy.score) / 2, fx, fy }
  }

  /**
   * Coarse search over [min, max], on blurred profiles that tolerate ~2px of accumulated
   * phase drift. Drift over the image is (length / period) × error, so the step grows
   * with the period.
   */
  search(min: number, max: number): number {
    const bx = boxBlur(this.x, 2)
    const by = boxBlur(this.y, 2)
    let best = { p: min, score: -Infinity }
    for (let p = min; p <= max; p += (1.5 * p) / this.longest) {
      const c = this.score(p, bx, by)
      if (c.score > best.score) best = c
    }
    return best.p
  }

  /** Best period near p, on the sharp profiles. `slack` widens the window (coarser input). */
  refine(p: number, slack = 1): Candidate {
    const span = (3 * slack * p) / this.longest
    let best = this.score(p)
    for (let q = p - span; q <= p + span; q += span / 60) {
      const c = this.score(q)
      if (c.score > best.score) best = c
    }
    return best
  }

  /**
   * Maps are usually exported as a whole number of cells. If the image is within a hair of
   * a whole number of cells on both axes, use that exact size when it fits as well.
   */
  snapToWholeCells(c: Candidate, img: GrayImage): Candidate {
    const nx = Math.round(img.width / c.p)
    const ny = Math.round(img.height / c.p)
    for (const exact of [img.width / nx, img.height / ny]) {
      const fitsBoth =
        Math.abs(img.width / exact - nx) < 0.1 && Math.abs(img.height / exact - ny) < 0.1
      if (fitsBoth && Math.abs(exact - c.p) < 0.005 * c.p) {
        const snapped = this.score(exact)
        if (snapped.score >= 0.95 * c.score) return snapped
      }
    }
    return c
  }
}

/**
 * Column (axis 'x') or row (axis 'y') profile of thin-line evidence.
 *
 * Per pixel, a ridge test along the axis: a dark line pixel is darker than *both* pixels
 * 2px away (a light line, lighter than both). This ignores edges between regions, which
 * are most of what art produces, and doesn't fire beside a line, so every line gives one
 * response centred on it regardless of width or anti-aliasing. Responses are capped low so
 * a faint grid line crossing the whole map outweighs a few bold art strokes.
 */
export function lineProfile(img: GrayImage, axis: 'x' | 'y', polarity: Polarity): Float64Array {
  const { width, height, data } = img
  const along = axis === 'x' ? width : height
  const across = axis === 'x' ? height : width
  const step = axis === 'x' ? 1 : width // index step along the axis
  const stride = axis === 'x' ? width : 1 // index step across the axis
  const profile = new Float64Array(along)
  const CAP = 0.03
  const sign = polarity === 'dark' ? 1 : -1

  for (let a = 0; a < across; a++) {
    const base = a * stride
    for (let i = 2; i < along - 2; i++) {
      const p = base + i * step
      // Flip light lines into dark ones so one ridge test serves both.
      const v = sign * data[p]
      const l = sign * data[p - 2 * step]
      const r = sign * data[p + 2 * step]
      profile[i] += Math.min(Math.max(0, Math.min(l, r) - v), CAP)
    }
  }
  return highPass(profile, 9)
}

/** Subtract a centred moving average, removing slow trends in the profile. */
function highPass(signal: Float64Array, radius: number): Float64Array {
  const n = signal.length
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + signal[i]
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(n, i + radius + 1)
    out[i] = signal[i] - (prefix[hi] - prefix[lo]) / (hi - lo)
  }
  return out
}

function boxBlur(signal: Float64Array, radius: number): Float64Array {
  const n = signal.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = i - radius; j <= i + radius; j++) sum += signal[Math.min(n - 1, Math.max(0, j))]
    out[i] = sum / (2 * radius + 1)
  }
  return out
}

export interface Fold {
  period: number
  score: number
  /** Sub-pixel phase of the peak, in [0, period). */
  phase: number
}

/**
 * Fold the profile modulo `period` into equal phase bins of ~1px (a fractional last bin
 * would hold only a few samples, and its noisy mean could win).
 *
 * Score is a signal-to-noise ratio: the strongest bin above the median bin, against the
 * spread a bin would have if the profile were random noise (σ / √folds). This naturally
 * prefers the true period over its multiples (same peak, fewer folds: ÷√2 at 2p) and its
 * fractions (peak diluted: ×0.71 at p/2).
 */
export function foldScore(profile: Float64Array, period: number, sigma = stdDev(profile)): Fold {
  const bins = Math.round(period)
  const binWidth = period / bins
  const sums = new Float64Array(bins)
  const counts = new Float64Array(bins)
  for (let i = 0; i < profile.length; i++) {
    const b = Math.min(bins - 1, Math.floor((i % period) / binWidth))
    sums[b] += profile[i]
    counts[b]++
  }
  let best = 0
  for (let b = 0; b < bins; b++) {
    sums[b] = counts[b] ? sums[b] / counts[b] : 0
    if (sums[b] > sums[best]) best = b
  }
  const baseline = [...sums].sort((a, b) => a - b)[bins >> 1]
  const folds = profile.length / period
  const score = ((sums[best] - baseline) * Math.sqrt(folds)) / (sigma || 1e-9)

  // Sub-pixel phase: centroid of the peak (±3 bins, above the baseline). A line smeared
  // over two pixels, or with a shadow on one side, still lands on its centre.
  let weight = 0
  let offset = 0
  for (let d = -3; d <= 3; d++) {
    const w = Math.max(0, sums[(((best + d) % bins) + bins) % bins] - baseline)
    weight += w
    offset += w * d
  }
  const centre = best + 0.5 + (weight ? offset / weight : 0)
  const phase = (((centre * binWidth) % period) + period) % period

  return { period, score, phase }
}

function stdDev(signal: Float64Array): number {
  let sum = 0
  let sq = 0
  for (const v of signal) {
    sum += v
    sq += v * v
  }
  const mean = sum / signal.length
  return Math.sqrt(Math.max(0, sq / signal.length - mean * mean))
}
