import { foldScore, lineProfile, type GrayImage, type GridDetection } from './gridDetect'

/**
 * Automatic walls and doors from a battlemap image, given its grid; and a better grid for
 * maps without a drawn one, from their walls.
 */

export interface RgbImage {
  width: number
  height: number
  /** r, g, b in 0..1, row-major, 3 values per pixel. */
  data: Float32Array
}

/**
 * A map image the detectors can ask for at reduced size (they work at a few pixels per
 * square), so huge maps needn't be decoded at full size.
 */
export interface MapImage {
  width: number
  height: number
  /** The image scaled by `scale` (at most 1). */
  scaled(scale: number): RgbImage
}

/** A MapImage over pixels already in memory. */
export function mapImageOf(img: RgbImage): MapImage {
  return { width: img.width, height: img.height, scaled: (scale) => (scale >= 1 ? img : resample(img, scale)) }
}

export interface GridSpec {
  /** Square size in image pixels. */
  period: number
  /** Image-pixel position of a vertical / horizontal grid line. */
  phaseX: number
  phaseY: number
}

/** Image in CIE Lab (L 0..100), 3 values per pixel. */
export interface LabImage {
  width: number
  height: number
  data: Float32Array
}

export function toRgb(rgba: ArrayLike<number>, width: number, height: number): RgbImage {
  const data = new Float32Array(width * height * 3)
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    data[i * 3] = rgba[j] / 255
    data[i * 3 + 1] = rgba[j + 1] / 255
    data[i * 3 + 2] = rgba[j + 2] / 255
  }
  return { width, height, data }
}

/** Area-average resample by a (fractional) factor < 1. */
export function resample(img: RgbImage, scale: number): RgbImage {
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))
  const data = new Float32Array(width * height * 3)
  const inv = 1 / scale
  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor(y * inv)
    const sy1 = Math.min(img.height, Math.max(sy0 + 1, Math.floor((y + 1) * inv)))
    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor(x * inv)
      const sx1 = Math.min(img.width, Math.max(sx0 + 1, Math.floor((x + 1) * inv)))
      let r = 0
      let g = 0
      let b = 0
      for (let sy = sy0; sy < sy1; sy++) {
        let i = (sy * img.width + sx0) * 3
        for (let sx = sx0; sx < sx1; sx++, i += 3) {
          r += img.data[i]
          g += img.data[i + 1]
          b += img.data[i + 2]
        }
      }
      const n = (sy1 - sy0) * (sx1 - sx0)
      const o = (y * width + x) * 3
      data[o] = r / n
      data[o + 1] = g / n
      data[o + 2] = b / n
    }
  }
  return { width, height, data }
}

function toGrayImage(img: RgbImage): GrayImage {
  const data = new Float32Array(img.width * img.height)
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.299 * img.data[i * 3] + 0.587 * img.data[i * 3 + 1] + 0.114 * img.data[i * 3 + 2]
  }
  return { width: img.width, height: img.height, data }
}

export function toLab(img: RgbImage): LabImage {
  const data = new Float32Array(img.data.length)
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  for (let i = 0; i < data.length; i += 3) {
    const r = lin(img.data[i])
    const g = lin(img.data[i + 1])
    const b = lin(img.data[i + 2])
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
    data[i] = 116 * y - 16
    data[i + 1] = 500 * (x - y)
    data[i + 2] = 200 * (y - z)
  }
  return { width: img.width, height: img.height, data }
}

/** A unit grid edge: between two neighbouring grid intersections. */
export interface Edge {
  /** 'v': vertical edge on grid line x = i, from row j to j+1; 'h': horizontal on y = j. */
  axis: 'v' | 'h'
  i: number
  j: number
  /** How strongly a stroke along the edge stands out from both sides (Lab ΔE). */
  stroke: number
  /** The stroke's width in squares, and its centre's offset from the grid line. */
  width: number
  offset: number
  /** Median colours: on the stroke, and well inside each side. */
  color: number[]
  sideA: number[]
  sideB: number[]
}

const dist = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * Score every unit grid edge for a wall stroke along it. Per edge, a colour profile across
 * the edge (per-offset median along the edge's middle, so furniture or a grid line crossing
 * it don't count) is compared with the colours well inside the squares either side.
 * `S`, `px`, `py`: square size and grid line position in the work image's pixels.
 */
export function scoreEdges(lab: LabImage, S: number, px: number, py: number): Edge[] {
  const edges: Edge[] = []
  const { width, height, data } = lab
  const half = Math.floor(0.45 * S)
  const at = (x: number, y: number, c: number) =>
    data[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 3 + c]
  const i0 = Math.ceil((0 - px) / S)
  const j0 = Math.ceil((0 - py) / S)
  const nx = Math.floor((width - px) / S)
  const ny = Math.floor((height - py) / S)
  const samples: number[][] = [[], [], []]
  const profile: number[][] = []

  for (const axis of ['v', 'h'] as const) {
    // i: the grid line (x for vertical edges, y for horizontal); j: the square along it.
    const [iFrom, iTo, jFrom, jTo] = axis === 'v' ? [i0, nx, j0, ny] : [j0, ny, i0, nx]
    for (let i = iFrom; i <= iTo; i++) {
      for (let j = jFrom; j < jTo; j++) {
        // Along: the edge's own direction; across: perpendicular to it.
        const lineAt = axis === 'v' ? px + i * S : py + i * S
        const start = axis === 'v' ? py + j * S : px + j * S
        const line = Math.round(lineAt)
        profile.length = 0
        for (let d = -half; d <= half; d++) {
          for (const s of samples) s.length = 0
          for (let t = Math.round(start + 0.15 * S); t <= Math.round(start + 0.85 * S); t++) {
            const x = axis === 'v' ? line + d : t
            const y = axis === 'v' ? t : line + d
            for (let c = 0; c < 3; c++) samples[c].push(at(x, y, c))
          }
          profile.push(samples.map(median))
        }
        const edge = strokeOf(profile, S)
        edges.push({ axis, i, j, ...edge })
      }
    }
  }
  return edges
}

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b)
  return s[s.length >> 1]
}

function mean3(rows: number[][]) {
  const m = [0, 0, 0]
  for (const r of rows) for (let c = 0; c < 3; c++) m[c] += r[c] / rows.length
  return m
}

/** The strongest stroke near the middle of a cross-edge profile (index = offset + half). */
function strokeOf(profile: number[][], S: number) {
  const n = profile.length
  const half = n >> 1
  const sideLen = Math.max(1, Math.round(0.15 * S))
  const sideA = mean3(profile.slice(0, sideLen))
  const sideB = mean3(profile.slice(n - sideLen))
  const reach = Math.round(0.28 * S)
  let best = 0
  let bestD = 0
  const contrast = profile.map((p) => Math.min(dist(p, sideA), dist(p, sideB)))
  for (let d = -reach; d <= reach; d++) {
    if (contrast[half + d] > best) {
      best = contrast[half + d]
      bestD = d
    }
  }
  // Width: the run around the peak standing out by at least half the peak.
  let lo = half + bestD
  let hi = half + bestD
  while (lo > 0 && contrast[lo - 1] >= best / 2) lo--
  while (hi < n - 1 && contrast[hi + 1] >= best / 2) hi++
  return {
    stroke: best,
    width: (hi - lo + 1) / S,
    offset: ((lo + hi) / 2 - half) / S,
    color: profile[half + bestD],
    sideA,
    sideB,
  }
}

/** Box blur of each channel, radius r (separable, clamped at the borders). */
export function blurLab(img: LabImage, r: number): LabImage {
  const { width, height } = img
  const tmp = new Float32Array(img.data.length)
  const out = new Float32Array(img.data.length)
  const n = 2 * r + 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let d = -r; d <= r; d++) sum += img.data[(y * width + Math.min(width - 1, Math.max(0, x + d))) * 3 + c]
        tmp[(y * width + x) * 3 + c] = sum / n
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let d = -r; d <= r; d++) sum += tmp[(Math.min(height - 1, Math.max(0, y + d)) * width + x) * 3 + c]
        out[(y * width + x) * 3 + c] = sum / n
      }
    }
  }
  return { width, height, data: out }
}

export interface VoidResult {
  /** 1 where void. */
  mask: Uint8Array
  /** 'none': no void (outdoor maps); 'frame': only a dark frame around the map. */
  kind: 'none' | 'frame' | 'void'
}

/**
 * Void: the dark background many dungeon maps are drawn on (rock, black, flat grey), which
 * isn't walkable. Found as the colour of the image border where it's smooth, in the areas
 * reaching the border plus large ones enclosed by the dungeon, then grown on through the
 * drop shadows and shading around the walls up to their drawn edges. Empty when the border
 * isn't dark (outdoor maps); only the frame when the dark border is just a frame.
 */
export function voidMask(lab: LabImage, S: number, log: (m: string) => void = () => {}): VoidResult {
  const { width, height } = lab
  const smooth = blurLab(lab, Math.max(1, Math.round(0.15 * S)))
  const d = smooth.data
  const mask = new Uint8Array(width * height)
  // The border ring, a little in from the edge: maps often have a decorative frame.
  const inner = Math.round(0.75 * S)
  const ring = Math.round(1.75 * S)
  const inRing = (x: number, y: number) => {
    const e = Math.min(x, y, width - 1 - x, height - 1 - y)
    return e >= inner && e < ring
  }
  const border: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (inRing(x, y)) border.push(y * width + x)
  }
  const voidColor = [0, 1, 2].map((c) => median(border.map((i) => d[i * 3 + c])))
  log(`void colour L${voidColor[0].toFixed(1)} a${voidColor[1].toFixed(1)} b${voidColor[2].toFixed(1)}`)
  if (voidColor[0] > 40) return { mask, kind: 'none' }

  const distTo = (i: number) => dist([d[i * 3], d[i * 3 + 1], d[i * 3 + 2]], voidColor)
  const T = Math.max(10, 3 * median(border.map(distTo)))
  // Void is smooth; floors and walls are drawn with detail (tiles, bricks, outlines).
  const texture = localStd(lab, Math.max(1, Math.round(0.3 * S)))
  const tau = Math.max(3, 2.5 * median(border.map((i) => texture[i])))
  const near = new Uint8Array(width * height)
  for (let i = 0; i < near.length; i++) near[i] = distTo(i) < T && texture[i] < tau ? 1 : 0

  // Dark regions that reach the border are void; enclosed ones may be.
  const islands = components(near, width, height)
  const enclosed: number[][] = []
  for (const members of islands) {
    if (members.some((i) => inRing(i % width, Math.floor(i / width)))) for (const i of members) mask[i] = 1
    else if (members.length >= S * S) enclosed.push(members)
  }
  // Enclosed void only counts on maps drawn on void (an outdoor scene in a frame can have
  // dark floors).
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let content = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) continue
    const x = i % width
    const y = (i - x) / width
    content++
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const fill = content / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1))
  log(`content fills ${(fill * 100).toFixed(1)}% of its box, ${enclosed.length} enclosed`)
  // A frame: the rest nearly fills the image, as a near-full rectangle.
  const spans = (maxX - minX + 1) / width > 0.8 && (maxY - minY + 1) / height > 0.8
  if (fill > 0.85 && spans) return { mask: frameOnly(mask, width, height, minX, minY, maxX, maxY), kind: 'frame' }
  for (const members of enclosed) for (const i of members) mask[i] = 1

  // The void found so far stops short of the walls (shadows, rock shading). Grow it up to
  // them: through pixels darker than halfway to the drawn side, or smooth and no lighter.
  const band = dilateCount(mask, width, height, Math.round(1.5 * S))
  const beside: number[] = []
  for (let i = 0; i < mask.length; i++) if (!mask[i] && band[i]) beside.push(d[i * 3])
  const besideL = beside.length ? median(beside) : voidColor[0] + 40
  const limit = (voidColor[0] + besideL) / 2
  const grad = gradientMagnitude(lab)
  let frontier: number[] = []
  for (let i = 0; i < mask.length; i++) if (mask[i]) frontier.push(i)
  for (let step = 0; step < S && frontier.length; step++) {
    const nextFrontier: number[] = []
    for (const i of frontier) {
      const x = i % width
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if (j < 0 || j >= mask.length || mask[j]) continue
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === width - 1)) continue
        if (d[j * 3] < limit || (grad[j] < 5 && d[j * 3] < besideL)) {
          mask[j] = 1
          nextFrontier.push(j)
        }
      }
    }
    frontier = nextFrontier
  }
  // Growth creeps along thin dark lines (outlines, cracks); keep only void at least about a
  // quarter square thick.
  return { mask: open(mask, width, height, Math.max(1, Math.round(0.12 * S))), kind: 'void' }
}

/** 4-connected components of set pixels, as lists of pixel indices. */
export function components(mask: Uint8Array, width: number, height: number): number[][] {
  const seen = new Uint8Array(mask.length)
  const out: number[][] = []
  const stack: number[] = []
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    const members: number[] = []
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      members.push(i)
      const x = i % width
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if (j < 0 || j >= mask.length || seen[j] || !mask[j]) continue
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === width - 1)) continue
        seen[j] = 1
        stack.push(j)
      }
    }
    out.push(members)
  }
  void height
  return out
}

/** Morphological opening (erode, then dilate) with a square of radius r. */
export function open(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  return dilate(erode(mask, width, height, r), width, height, r)
}

export function erode(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const inv = mask.map((v) => 1 - v)
  return dilate(inv, width, height, r).map((v) => 1 - v)
}

/** Dilation with a (2r+1)² square, separable (pixels beyond the image count as unset). */
export function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const tmp = new Uint8Array(mask.length)
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    let last = -Infinity
    const row = y * width
    // Forward and backward passes find the nearest set pixel on each side.
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) last = x
      if (x - last <= r) tmp[row + x] = 1
    }
    last = Infinity
    for (let x = width - 1; x >= 0; x--) {
      if (mask[row + x]) last = x
      if (last - x <= r) tmp[row + x] = 1
    }
  }
  for (let x = 0; x < width; x++) {
    let last = -Infinity
    for (let y = 0; y < height; y++) {
      if (tmp[y * width + x]) last = y
      if (y - last <= r) out[y * width + x] = 1
    }
    last = Infinity
    for (let y = height - 1; y >= 0; y--) {
      if (tmp[y * width + x]) last = y
      if (last - y <= r) out[y * width + x] = 1
    }
  }
  return out
}

/** Pixels within r (city-block) of a set pixel, not themselves set: 1. */
function dilateCount(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  let frontier: number[] = []
  const seen = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) if (mask[i]) { seen[i] = 1; frontier.push(i) }
  for (let step = 0; step < r && frontier.length; step++) {
    const next: number[] = []
    for (const i of frontier) {
      const x = i % width
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if (j < 0 || j >= mask.length || seen[j]) continue
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === width - 1)) continue
        seen[j] = 1
        out[j] = 1
        next.push(j)
      }
    }
    frontier = next
  }
  void height
  return out
}

/** Just a frame around the map: it's beyond the map's edge, not void to wall off. */
function frameOnly(mask: Uint8Array, width: number, height: number, ...box: number[]) {
  const [minX, minY, maxX, maxY] = box
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) mask[y * width + x] = x < minX || x > maxX || y < minY || y > maxY ? 1 : 0
  }
  return mask
}

/** Lightness gradient magnitude (Sobel, per pixel). */
export function gradientMagnitude(lab: LabImage): Float32Array {
  const { width, height, data } = lab
  const L = (x: number, y: number) =>
    data[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 3]
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1)
      const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1)
      out[y * width + x] = Math.hypot(gx, gy) / 8
    }
  }
  return out
}

/** Local standard deviation of lightness, in a (2r+1)² window. */
export function localStd(lab: LabImage, r: number): Float32Array {
  const { width, height, data } = lab
  const L: LabImage = { width, height, data: new Float32Array(data.length) }
  for (let i = 0; i < width * height; i++) {
    L.data[i * 3] = data[i * 3]
    L.data[i * 3 + 1] = data[i * 3] * data[i * 3]
  }
  const m = blurLab(L, r)
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(Math.max(0, m.data[i * 3 + 1] - m.data[i * 3] ** 2))
  return out
}


export interface Pt {
  x: number
  y: number
}

/**
 * Outlines of a binary mask as closed polygons (marching squares on pixel centres, vertices
 * at edge midpoints). Pixels outside the image count as 0.
 */
export function traceContours(mask: Uint8Array, width: number, height: number): Pt[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? mask[y * width + x] : 0)
  // Cell (x, y) has corners at pixel centres (x-1..x, y-1..y); segments keyed by cell + side.
  const W = width + 1
  const H = height + 1
  // Each cell side: 0 top, 1 right, 2 bottom, 3 left; its midpoint as a vertex.
  const mid = (cx: number, cy: number, side: number): Pt => {
    const x = cx - 1
    const y = cy - 1
    if (side === 0) return { x: x + 0.5, y }
    if (side === 1) return { x: x + 1, y: y + 0.5 }
    if (side === 2) return { x: x + 0.5, y: y + 1 }
    return { x, y: y + 0.5 }
  }
  // Directed segments (inside on the left... consistent orientation): from side to side.
  const TABLE: Record<number, [number, number][]> = {
    1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[1, 0]], 5: [[3, 0], [1, 2]], 6: [[2, 0]], 7: [[3, 0]],
    8: [[0, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[0, 1]], 12: [[1, 3]], 13: [[1, 2]], 14: [[2, 3]],
  }
  // next[key of start point] = key of end point, with keys as shared-edge ids.
  const keyOf = (cx: number, cy: number, side: number) => {
    // Shared between neighbouring cells: normalise to top/left sides.
    if (side === 2) return ((cy + 1) * W + cx) * 2
    if (side === 1) return (cy * W + cx + 1) * 2 + 1
    if (side === 0) return (cy * W + cx) * 2
    return (cy * W + cx) * 2 + 1
  }
  const next = new Map<number, number>()
  const point = new Map<number, Pt>()
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      // Corner bits: tl 8, tr 4, br 2, bl 1 (pixel centres around the cell).
      const code =
        (at(cx - 1, cy - 1) << 3) | (at(cx, cy - 1) << 2) | (at(cx, cy) << 1) | at(cx - 1, cy)
      const segs = TABLE[code]
      if (!segs) continue
      for (const [a, b] of segs) {
        const ka = keyOf(cx, cy, a)
        const kb = keyOf(cx, cy, b)
        next.set(ka, kb)
        point.set(ka, mid(cx, cy, a))
        point.set(kb, mid(cx, cy, b))
      }
    }
  }
  const loops: Pt[][] = []
  const seen = new Set<number>()
  for (const start of next.keys()) {
    if (seen.has(start)) continue
    const loop: Pt[] = []
    let k: number | undefined = start
    while (k !== undefined && !seen.has(k)) {
      seen.add(k)
      loop.push(point.get(k)!)
      k = next.get(k)
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** Douglas–Peucker simplification of a closed polygon. */
export function simplifyClosed(poly: Pt[], tolerance: number): Pt[] {
  if (poly.length < 4) return poly
  // Split at the two farthest-apart vertices, simplify each half as an open line.
  let far = 0
  let best = -1
  for (let i = 0; i < poly.length; i++) {
    const d = Math.hypot(poly[i].x - poly[0].x, poly[i].y - poly[0].y)
    if (d > best) {
      best = d
      far = i
    }
  }
  const a = simplifyOpen(poly.slice(0, far + 1), tolerance)
  const b = simplifyOpen([...poly.slice(far), poly[0]], tolerance)
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

export function simplifyOpen(line: Pt[], tolerance: number): Pt[] {
  if (line.length < 3) return line
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let idx = -1
    let max = tolerance
    for (let i = s + 1; i < e; i++) {
      const d = pointLineDistance(line[i], line[s], line[e])
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (idx >= 0) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  return line.filter((_, i) => keep[i])
}

function pointLineDistance(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len
}

export function polygonArea(poly: Pt[]) {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  return a / 2
}

/**
 * Straighten a traced outline onto the grid where the walls follow it. Edges that run along
 * an axis for most of a square are moved onto the grid line that best separates floor from
 * non-floor (cells either side mostly one or the other), so walls drawn centred on grid
 * lines land on them even though the outline traced their outer face. Curved stretches
 * (caves, round rooms) are kept as traced.
 *
 * `floor`: 1 where walkable; `S`, `px`, `py`: the grid in work-image pixels.
 */
export function rectify(poly: Pt[], floor: Uint8Array, width: number, height: number, S: number, px: number, py: number): Pt[] {
  const n = poly.length
  if (n < 3) return poly
  const floorAt = (x: number, y: number) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    return xi >= 0 && yi >= 0 && xi < width && yi < height ? floor[yi * width + xi] : 0
  }
  // Fraction of floor in a strip: x in [x0, x1), y in [y0, y1).
  const fraction = (x0: number, x1: number, y0: number, y1: number) => {
    let sum = 0
    let count = 0
    for (let y = Math.ceil(y0); y < y1; y++) {
      for (let x = Math.ceil(x0); x < x1; x++) {
        sum += floorAt(x, y)
        count++
      }
    }
    return count ? sum / count : 0
  }
  type Axis = { kind: 'v' | 'h'; at: number } | null
  const axes: Axis[] = []
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    const tilt = Math.abs(Math.atan2(Math.min(Math.abs(dx), Math.abs(dy)), Math.max(Math.abs(dx), Math.abs(dy))))
    if (len < 0.6 * S || tilt > (12 * Math.PI) / 180) {
      axes.push(null)
      continue
    }
    const vertical = Math.abs(dy) > Math.abs(dx)
    const c = vertical ? (a.x + b.x) / 2 : (a.y + b.y) / 2
    const origin = vertical ? px : py
    // Span along the edge, trimmed at the ends (corners).
    const lo = Math.min(vertical ? a.y : a.x, vertical ? b.y : b.x) + 0.15 * len
    const hi = Math.max(vertical ? a.y : a.x, vertical ? b.y : b.x) - 0.15 * len
    let best = { at: c, score: -Infinity }
    const k0 = Math.round((c - origin) / S)
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const g = origin + k * S
      if (Math.abs(g - c) > 0.75 * S) continue
      const before = vertical ? fraction(g - 0.5 * S, g, lo, hi) : fraction(lo, hi, g - 0.5 * S, g)
      const after = vertical ? fraction(g, g + 0.5 * S, lo, hi) : fraction(lo, hi, g, g + 0.5 * S)
      const score = Math.abs(before - after)
      if (score > best.score) best = { at: g, score }
    }
    // Only a real floor/non-floor boundary is worth straightening onto.
    axes.push(best.score >= 0.4 ? { kind: vertical ? 'v' : 'h', at: best.at } : null)
  }

  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const prev = axes[(i - 1 + n) % n]
    const next = axes[i]
    const v = poly[i]
    if (prev && next && prev.kind !== next.kind) {
      out.push(prev.kind === 'v' ? { x: prev.at, y: next.at } : { x: next.at, y: prev.at })
    } else if (prev && next) {
      // Parallel neighbours on different lines: a step between them, at the vertex.
      if (prev.at === next.at) continue
      const snap = (val: number, origin: number) => origin + Math.round((val - origin) / S) * S
      if (prev.kind === 'v') {
        const y = snap(v.y, py)
        out.push({ x: prev.at, y }, { x: next.at, y })
      } else {
        const x = snap(v.x, px)
        out.push({ x, y: prev.at }, { x, y: next.at })
      }
    } else if (prev) {
      out.push(prev.kind === 'v' ? { x: prev.at, y: v.y } : { x: v.x, y: prev.at })
    } else if (next) {
      out.push(next.kind === 'v' ? { x: next.at, y: v.y } : { x: v.x, y: next.at })
    } else {
      out.push(v)
    }
  }
  return dedupe(out)
}

/** Drop repeated points and middle points of straight runs (closed polygon). */
function dedupe(poly: Pt[]): Pt[] {
  let pts = poly.filter((p, i) => {
    const q = poly[(i + 1) % poly.length]
    return Math.hypot(p.x - q.x, p.y - q.y) > 1e-6
  })
  let changed = true
  while (changed && pts.length > 3) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length]
      const b = pts[i]
      const c = pts[(i + 1) % pts.length]
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
      if (Math.abs(cross) < 1e-6) {
        pts = pts.filter((_, j) => j !== i)
        changed = true
        break
      }
    }
  }
  return pts
}

/** A wall segment along grid lines, in grid units (corner coordinates). */
export interface GridSegment {
  a: Pt
  b: Pt
}

/**
 * Wall lines drawn between floors (inside buildings, or on outdoor maps): edges whose stroke
 * stands out, kept by hysteresis like edge detection. Strong strokes seed a wall line; it
 * continues along the grid line through weaker ones. Short isolated bits (furniture, a
 * pillar) are dropped.
 *
 * `interior(edge)`: whether both sides of the edge are floor (not void).
 */
export function strokeWalls(edges: Edge[], interior: (e: Edge) => boolean, log: (m: string) => void = () => {}): Edge[] {
  const candidates = edges.filter((e) => interior(e) && e.width <= 0.45)
  if (!candidates.length) return []
  const scores = candidates.map((e) => e.stroke).sort((a, b) => a - b)
  const q99 = scores[Math.floor(0.99 * (scores.length - 1))]
  const high = Math.max(22, 0.8 * q99)
  const low = 0.55 * high
  log(`stroke walls: q99 ${q99.toFixed(1)} high ${high.toFixed(1)} low ${low.toFixed(1)}`)
  const key = (axis: string, i: number, j: number) => `${axis}${i},${j}`
  const byKey = new Map(candidates.map((e) => [key(e.axis, e.i, e.j), e]))
  const kept = new Set<Edge>()
  // Runs along each grid line: consecutive edges at least `low`, with a seed among them.
  for (const e of candidates) {
    if (e.stroke < high || kept.has(e)) continue
    const run = [e]
    for (const dir of [-1, 1]) {
      for (let j = e.j + dir; ; j += dir) {
        const n = byKey.get(key(e.axis, e.i, j))
        if (!n || n.stroke < low) break
        run.push(n)
      }
    }
    for (const r of run) kept.add(r)
  }
  // Drop pieces of wall that are tiny on their own: connected groups spanning one square.
  const result = [...kept]
  const groups = groupEdges(result)
  return groups.filter((g) => g.length >= 2 && spanOf(g) > 1).flat()
}

/** Edge endpoints in grid-corner coordinates. */
export function edgeEnds(e: Edge): [Pt, Pt] {
  return e.axis === 'v'
    ? [{ x: e.i, y: e.j }, { x: e.i, y: e.j + 1 }]
    : [{ x: e.j, y: e.i }, { x: e.j + 1, y: e.i }]
}

/** Edges grouped by shared corners. */
function groupEdges(edges: Edge[]): Edge[][] {
  const at = new Map<string, Edge[]>()
  for (const e of edges) {
    for (const p of edgeEnds(e)) {
      const k = `${p.x},${p.y}`
      if (!at.has(k)) at.set(k, [])
      at.get(k)!.push(e)
    }
  }
  const seen = new Set<Edge>()
  const groups: Edge[][] = []
  for (const start of edges) {
    if (seen.has(start)) continue
    const group: Edge[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const e = stack.pop()!
      group.push(e)
      for (const p of edgeEnds(e)) {
        for (const n of at.get(`${p.x},${p.y}`) ?? []) {
          if (!seen.has(n)) {
            seen.add(n)
            stack.push(n)
          }
        }
      }
    }
    groups.push(group)
  }
  return groups
}

/** The larger side of a group's bounding box, in squares. */
function spanOf(group: Edge[]) {
  const pts = group.flatMap(edgeEnds)
  const w = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))
  const h = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))
  return Math.max(w, h)
}

export interface DetectedWall {
  /** Polyline in image pixels; closed outlines repeat the first point at the end. */
  points: Pt[]
  door?: boolean
}

export interface WallDetectOptions {
  log?: (message: string) => void
}

/** Square size in the work image the detector runs at, in pixels. */
const WORK_SQUARE = 16

/**
 * Walls and doors for a battlemap with a known grid: outlines of the walkable area where
 * the map is drawn on void (snapped onto grid lines where they run along them), wall lines
 * drawn between floors, and doors in the gaps of those lines.
 */
export function detectWalls(map: MapImage, grid: GridSpec, options: WallDetectOptions = {}): DetectedWall[] {
  const log = options.log ?? (() => {})
  // Below 16 px per square the art is too coarse to read walls from; work at full size.
  const scale = Math.min(1, WORK_SQUARE / grid.period)
  const small = map.scaled(scale)
  // The scaled image's size is rounded: use its actual scale.
  const actual = small.width / map.width
  const Sw = grid.period * actual
  const lab = toLab(small)
  const { width, height } = small
  const px = (((grid.phaseX % grid.period) + grid.period) % grid.period) * actual
  const py = (((grid.phaseY % grid.period) + grid.period) % grid.period) * actual
  const toImage = (p: Pt): Pt => ({ x: p.x / actual, y: p.y / actual })
  const gridToImage = (p: Pt): Pt => toImage({ x: px + p.x * Sw, y: py + p.y * Sw })

  const voids = voidMask(lab, Sw, log)
  const floor = voids.mask.map((v) => 1 - v)
  log(`void: ${voids.kind}`)
  const walls: DetectedWall[] = []

  // Outlines of the walkable area, where it's drawn on void.
  if (voids.kind === 'void') {
    const loops = traceContours(floor, width, height).filter(
      (l) => Math.abs(polygonArea(l)) > 1.5 * Sw * Sw && !alongBorder(l, width, height, Sw),
    )
    for (const loop of loops) {
      const poly = rectify(simplifyClosed(loop, 0.25 * Sw), floor, width, height, Sw, px, py)
      if (poly.length < 3) continue
      const points = poly.map(toImage)
      walls.push({ points: [...points, { ...points[0] }] })
    }
    log(`${walls.length} outlines`)
  }

  // Wall lines between floors.
  const frac = (x0: number, x1: number, y0: number, y1: number) => {
    let sum = 0
    let n = 0
    for (let y = Math.max(0, Math.ceil(y0)); y < Math.min(height, y1); y++) {
      for (let x = Math.max(0, Math.ceil(x0)); x < Math.min(width, x1); x++) {
        sum += floor[y * width + x]
        n++
      }
    }
    return n ? sum / n : 0
  }
  const interior = (e: Edge) => {
    const [a, b] = edgeEnds(e).map((p) => ({ x: px + p.x * Sw, y: py + p.y * Sw }))
    const near = 0.1 * Sw
    const far = 0.5 * Sw
    const fa = e.axis === 'v' ? frac(a.x - far, a.x - near, a.y, b.y) : frac(a.x, b.x, a.y - far, a.y - near)
    const fb = e.axis === 'v' ? frac(a.x + near, a.x + far, a.y, b.y) : frac(a.x, b.x, a.y + near, a.y + far)
    return fa > 0.6 && fb > 0.6
  }
  const edges = scoreEdges(lab, Sw, px, py)
  const lines = strokeWalls(edges, interior, log)
  const runs = mergeRuns(lines)
  for (const r of runs) walls.push({ points: [gridToImage(r.a), gridToImage(r.b)] })
  log(`${runs.length} wall lines`)

  // Doors: gaps of one or two squares in a wall line, between floors on both sides.
  const byKey = new Map(edges.map((e) => [`${e.axis}${e.i},${e.j}`, e]))
  let doors = 0
  const sorted = [...runs].sort((p, q) => (p.axis + p.line).localeCompare(q.axis + q.line) || p.from - q.from)
  for (let k = 1; k < sorted.length; k++) {
    const prev = sorted[k - 1]
    const next = sorted[k]
    if (prev.axis !== next.axis || prev.line !== next.line) continue
    const gap = next.from - prev.to
    if (gap < 1 || gap > 2) continue
    const gapEdges = Array.from({ length: gap }, (_, g) => byKey.get(`${next.axis}${next.line},${prev.to + g}`))
    if (!gapEdges.every((e) => e && interior(e))) continue
    const a = next.axis === 'v' ? { x: next.line, y: prev.to } : { x: prev.to, y: next.line }
    const b = next.axis === 'v' ? { x: next.line, y: next.from } : { x: next.from, y: next.line }
    walls.push({ points: [gridToImage(a), gridToImage(b)], door: true })
    doors++
  }
  log(`${doors} doors`)
  return walls
}

/** Whether most of an outline runs along the image's edge (a frame, not a room). */
function alongBorder(loop: Pt[], width: number, height: number, S: number) {
  let near = 0
  let total = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    if (Math.min(m.x, m.y, width - m.x, height - m.y) < S) near += len
    total += len
  }
  return near > 0.5 * total
}

interface Run {
  axis: 'v' | 'h'
  /** Grid line index, and the span along it [from, to) in squares. */
  line: number
  from: number
  to: number
  a: Pt
  b: Pt
}

/** Consecutive edges on a grid line merged into runs. */
function mergeRuns(edges: Edge[]): Run[] {
  const sorted = [...edges].sort((p, q) => (p.axis === q.axis ? 0 : p.axis < q.axis ? -1 : 1) || p.i - q.i || p.j - q.j)
  const runs: Run[] = []
  for (const e of sorted) {
    const last = runs.at(-1)
    if (last && last.axis === e.axis && last.line === e.i && last.to === e.j) last.to++
    else runs.push({ axis: e.axis, line: e.i, from: e.j, to: e.j + 1, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } })
  }
  for (const r of runs) {
    r.a = r.axis === 'v' ? { x: r.line, y: r.from } : { x: r.from, y: r.line }
    r.b = r.axis === 'v' ? { x: r.line, y: r.to } : { x: r.to, y: r.line }
  }
  return runs
}

/** A grid detection to refine (see refineGridByWalls); matches gridDetect's GridDetection. */
export type GridGuess = Pick<GridDetection, 'period' | 'phaseX' | 'phaseY' | 'confidence' | 'polarity'>

/** Maps exported for virtual tabletops are usually this many squares on their longer side. */
const TYPICAL_SQUARES = { min: 15, max: 64 }
/** Lines repeating at the square size this clearly (fold score) are drawn there on purpose. */
const DRAWN_LINES = 15
/** Detections at least this confident are taken to be a drawn grid, not floor tiles. */
const TILE_CONFIDENCE = 25

/**
 * Maps without a drawn grid often have floor tiles or bricks that the grid detector finds
 * instead, at a fraction of the real square. When a detection would give an implausible
 * number of squares, look for the multiple of it that the walls line up with: the edges of
 * the walkable area run along grid lines. Returns the guess unchanged when there's no
 * clear answer.
 */
export function refineGridByWalls(map: MapImage, guess: GridGuess, log: (m: string) => void = () => {}): GridGuess {
  const p = guess.period
  const img = map
  const longer = Math.max(img.width, img.height)
  // A clear drawn grid is the grid, however fine; tiles make a weaker pattern.
  if (longer / p <= TYPICAL_SQUARES.max || guess.confidence >= TILE_CONFIDENCE) return guess

  // Straight stretches of the walkable area's outline, at a scale where a square is a few
  // tiles (the real square isn't known yet).
  const S = WORK_SQUARE
  const small = map.scaled(Math.min(1, S / (3 * p)))
  const scale = small.width / map.width
  const voids = voidMask(toLab(small), S)
  if (voids.kind !== 'void') return guess
  const floor = voids.mask.map((v) => 1 - v)
  const loops = traceContours(floor, small.width, small.height)
    .filter((l) => Math.abs(polygonArea(l)) > 2 * S * S)
    .map((l) => simplifyClosed(l, 0.15 * S))
  // Straight stretches, by axis, with which side the floor is on: outlines run with the floor
  // on their right, so a stretch heading down has the floor west of it (an east wall).
  const xs: [number, number][] = []
  const ys: [number, number][] = []
  const faces: Record<'x' | 'y', { before: [number, number][]; after: [number, number][] }> = {
    x: { before: [], after: [] },
    y: { before: [], after: [] },
  }
  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const a = l[i]
      const b = l[(i + 1) % l.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 0.5 * S) continue
      if (Math.abs(b.x - a.x) < 0.05 * len) {
        const v: [number, number] = [(a.x + b.x) / 2 / scale, len / scale]
        xs.push(v)
        // Floor west of a downward stretch: the void (and the wall's outer face) is after it.
        ;(b.y > a.y ? faces.x.after : faces.x.before).push(v)
      } else if (Math.abs(b.y - a.y) < 0.05 * len) {
        const v: [number, number] = [(a.y + b.y) / 2 / scale, len / scale]
        ys.push(v)
        // Floor south of a westward... a stretch heading east has the floor south of it.
        ;(b.x > a.x ? faces.y.before : faces.y.after).push(v)
      }
    }
  }
  if (xs.length + ys.length < 12) return guess

  // Share of the outline (by length) near a grid line, for one axis: weighted by closeness
  // (full on the line, none half a tile away), so the best phase centres on the walls even
  // when the outline traced their faces either side of the line.
  const share = (vals: [number, number][], q: number, phase: number) => {
    let near = 0
    let total = 0
    for (const [c, len] of vals) {
      let d = (((c - phase) % q) + q) % q
      d = Math.min(d, q - d)
      near += len * Math.max(0, 1 - d / (0.5 * p))
      total += len
    }
    return total ? near / total : 0
  }
  const bestPhase = (vals: [number, number][], q: number) => {
    let best = { score: -1, phase: 0 }
    for (let phase = 0; phase < q; phase += q / 256) {
      const score = share(vals, q, phase)
      if (score > best.score) best = { score, phase }
    }
    return best
  }
  const scored: { period: number; phaseX: number; phaseY: number; score: number }[] = []
  for (let k = 2; k <= 12; k++) {
    const q = k * p
    const cols = img.width / q
    const rows = img.height / q
    const whole = Math.abs(cols - Math.round(cols)) < 0.1 && Math.abs(rows - Math.round(rows)) < 0.1
    const side = Math.max(cols, rows)
    if (!whole || side < TYPICAL_SQUARES.min || side > TYPICAL_SQUARES.max) continue
    const bx = bestPhase(xs, q)
    const by = bestPhase(ys, q)
    const score = (bx.score + by.score) / 2
    log(`walls: ${q.toFixed(1)}px (${Math.round(cols)}x${Math.round(rows)}) lines up ${(score * 100).toFixed(0)}%`)
    scored.push({ period: q, phaseX: bx.phase, phaseY: by.phase, score })
  }
  // A clear winner only: walls line up with it noticeably better than with the others.
  scored.sort((a, b) => b.score - a.score)
  const [best, second] = scored
  if (!best || best.score < 0.35 || (second && best.score < 1.15 * second.score)) return guess
  // Where the lines go. Outer faces of walls on one side of the rooms (void before them)
  // and the other (void after) sit the same distance either side of the grid lines: zero
  // where walls fill the squares beside the lines, half a wall where walls are drawn
  // centred on them (pillars at the corners on its intersections). The lines lie midway.
  // Lines drawn clearly at the square size (floor slabs) mark the grid themselves, though.
  const g = Math.min(1, 4096 / longer)
  const grayImg = map.scaled(g)
  const gs = grayImg.width / map.width
  const gray = toGrayImage(grayImg)
  const drawn = (axis: 'x' | 'y') => foldScore(lineProfile(gray, axis, guess.polarity), best.period * gs)
  const fx = drawn('x')
  const fy = drawn('y')
  log(`drawn lines at the square size: ${fx.score.toFixed(1)}, ${fy.score.toFixed(1)}`)
  const phaseX = fx.score >= DRAWN_LINES ? fx.phase / gs : (midline(faces.x.before, faces.x.after, best.period) ?? best.phaseX)
  const phaseY = fy.score >= DRAWN_LINES ? fy.phase / gs : (midline(faces.y.before, faces.y.after, best.period) ?? best.phaseY)
  log(`walls suggest ${best.period.toFixed(1)}px squares, lines at ${phaseX.toFixed(1)}, ${phaseY.toFixed(1)}`)
  return { ...guess, period: best.period, phaseX, phaseY }
}




/** Weighted circular mean of positions modulo q, and how concentrated they are (0..1). */
function circularMean(vals: [number, number][], q: number) {
  let cx = 0
  let cy = 0
  let total = 0
  for (const [c, w] of vals) {
    const a = (2 * Math.PI * c) / q
    cx += w * Math.cos(a)
    cy += w * Math.sin(a)
    total += w
  }
  const mean = ((((Math.atan2(cy, cx) / (2 * Math.PI)) * q) % q) + q) % q
  return { mean, concentration: total ? Math.hypot(cx, cy) / total : 0 }
}

/**
 * The grid line position (mod q) midway between walls' outer faces that have the void
 * before them (west/north) and after them (east/south): the first sit at line − d, the
 * second at line + d. Null without enough of both.
 */
function midline(before: [number, number][], after: [number, number][], q: number): number | null {
  if (before.length < 3 || after.length < 3) return null
  const a = circularMean(before, q)
  const b = circularMean(after, q)
  if (a.concentration < 0.3 || b.concentration < 0.3) return null
  // b = line + d and a = line − d, with 0 ≤ d < q/2: the line is halfway along from a to b.
  const arc = (((b.mean - a.mean) % q) + q) % q
  const d = arc <= q / 2 ? arc / 2 : (arc - q) / 2
  return (((a.mean + d) % q) + q) % q
}
