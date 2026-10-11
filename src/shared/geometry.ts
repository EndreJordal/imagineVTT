import type { Display, GridSettings, MapInfo, Point, Rect, Scene, Size } from './types'

/** Side of the on-table calibration square, in mm. */
export const CALIBRATION_MM = 100

/** Blank-scene extent (in squares) when no map image is loaded. */
const BLANK_SQUARES = { x: 40, y: 25 }

/** Scene-space area of the map image, or of a blank grid when there is no map. */
export function sceneBounds(scene: Scene): Rect {
  const { map, grid } = scene
  return map
    ? { x: map.x, y: map.y, width: map.width, height: map.height }
    : { x: 0, y: 0, width: BLANK_SQUARES.x * grid.size, height: BLANK_SQUARES.y * grid.size }
}

/**
 * Table-screen CSS pixels per map pixel, so one grid square = squareMm physically (times
 * the table zoom, when the GM zooms out for an overview).
 */
export function tableScale(scene: Scene, display: Display): number {
  return ((display.pxPerMm * scene.squareMm) / scene.grid.size) * (scene.viewZoom ?? 1)
}

/** Table zoom limits, and how close to true scale snaps to it. */
export const MIN_VIEW_ZOOM = 0.05
export const MAX_VIEW_ZOOM = 4
const VIEW_ZOOM_SNAP = 0.04

/** A table zoom within limits, snapped to true scale when it's close. */
export function clampViewZoom(zoom: number): number {
  if (Math.abs(zoom - 1) < VIEW_ZOOM_SNAP) return 1
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, zoom))
}

/**
 * Transform placing the map on the table screen, in the form a Pixi container takes:
 * screen = position + R(rotation) * scale * (p - pivot)
 */
export function tableTransform(scene: Scene, display: Display, screen: Size) {
  return {
    scale: tableScale(scene, display),
    rotation: (display.orientation * Math.PI) / 180,
    pivot: scene.view,
    position: { x: screen.width / 2, y: screen.height / 2 },
  }
}

/**
 * Map-space corners of the area visible on the table, in table-screen order
 * (top-left, top-right, bottom-right, bottom-left).
 */
export function tableViewCorners(scene: Scene, display: Display, screen: Size): Point[] {
  const s = tableScale(scene, display)
  const hw = screen.width / 2 / s
  const hh = screen.height / 2 / s
  const a = (-display.orientation * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({
    x: scene.view.x + x * cos - y * sin,
    y: scene.view.y + x * sin + y * cos,
  }))
}

/** The map image's pixel size as shown: width and height swap when it's turned a quarter. */
export function mapNatural(map: MapInfo): Size {
  return (map.turns ?? 0) % 2
    ? { width: map.naturalHeight, height: map.naturalWidth }
    : { width: map.naturalWidth, height: map.naturalHeight }
}

/** p turned `turns` quarter turns clockwise (screen axes, y down) about `pivot`. */
export function turnPoint(p: Point, pivot: Point, turns: number): Point {
  let dx = p.x - pivot.x
  let dy = p.y - pivot.y
  for (let i = 0; i < (((turns % 4) + 4) % 4); i++) [dx, dy] = [-dy, dx]
  return { x: pivot.x + dx, y: pivot.y + dy }
}

/** A rect turned a quarter turn (or several) about `pivot`: the same area, turned. */
export function turnRect(r: Rect, pivot: Point, turns: number): Rect {
  const c = turnPoint({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, pivot, turns)
  const [width, height] = turns % 2 ? [r.height, r.width] : [r.width, r.height]
  return { x: c.x - width / 2, y: c.y - height / 2, width, height }
}

/**
 * Where to turn the map about: the grid intersection nearest its centre, so grid lines land
 * on grid lines and a map matched to the grid stays matched.
 */
export function mapPivot(map: Rect, grid: GridSettings): Point {
  const near = (v: number, offset: number) => offset + Math.round((v - offset) / grid.size) * grid.size
  return { x: near(map.x + map.width / 2, grid.offsetX), y: near(map.y + map.height / 2, grid.offsetY) }
}

/** Map scale (relative to natural size) that puts the map's bottom-right corner nearest p. */
export function mapScaleForCorner(map: MapInfo, p: Point): number {
  const { width: w, height: h } = mapNatural(map)
  return ((p.x - map.x) * w + (p.y - map.y) * h) / (w * w + h * h)
}

/** Axis-aligned bounding box of a set of points. */
export function boundingRect(points: Point[]): Rect {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/**
 * Scale the map so it spans `target` along one axis, aligned with its edges on that axis.
 * The map's centre on the other axis stays where it was.
 */
export function fitMapToRect(map: MapInfo, target: Rect, axis: 'x' | 'y'): MapInfo {
  const natural = mapNatural(map)
  const scale = axis === 'x' ? target.width / natural.width : target.height / natural.height
  const width = natural.width * scale
  const height = natural.height * scale
  return axis === 'x'
    ? { ...map, width, height, x: target.x, y: map.y + (map.height - height) / 2 }
    : { ...map, width, height, y: target.y, x: map.x + (map.width - width) / 2 }
}

/**
 * Scale and place the map so a grid drawn in the image (cell `period` image pixels, lines
 * at `phaseX`/`phaseY`) lands exactly on the scene grid. The map moves by whole cells at
 * most from where it is, so it stays roughly in place.
 */
export function alignMapToGrid(
  map: MapInfo,
  grid: GridSettings,
  cell: { period: number; phaseX: number; phaseY: number },
): MapInfo {
  const scale = grid.size / cell.period
  // The image line at `phase` sits at map.x + phase·scale; that must be a scene grid line.
  const align = (current: number, phase: number, offset: number) => {
    const base = offset - phase * scale
    return base + Math.round((current - base) / grid.size) * grid.size
  }
  return {
    ...map,
    width: mapNatural(map).width * scale,
    height: mapNatural(map).height * scale,
    x: align(map.x, cell.phaseX, grid.offsetX),
    y: align(map.y, cell.phaseY, grid.offsetY),
  }
}

/**
 * Where a grid-locked map goes when the grid changes: scaled by the change in cell size
 * and positioned so it keeps the same place relative to the grid lines.
 */
export function followGrid(map: MapInfo, from: GridSettings, to: GridSettings): MapInfo {
  const k = to.size / from.size
  return {
    ...map,
    x: to.offsetX + (map.x - from.offsetX) * k,
    y: to.offsetY + (map.y - from.offsetY) * k,
    width: map.width * k,
    height: map.height * k,
  }
}

/**
 * Where a point on the map ends up when the map is moved or scaled from one placement to
 * another: it keeps its place on the map image.
 */
export function carryPoint(p: Point, from: Rect, to: Rect): Point {
  const k = to.width / from.width
  return { x: to.x + (p.x - from.x) * k, y: to.y + (p.y - from.y) * k }
}

/**
 * Nearest snap point to p: grid line intersections every `fraction` of a square (1, 1/2,
 * 1/4), aligned with the grid's offset. 0 means no snapping.
 */
export function snapToGrid(p: Point, grid: GridSettings, fraction: number): Point {
  if (fraction <= 0) return { x: p.x, y: p.y }
  const step = grid.size * fraction
  return {
    x: grid.offsetX + Math.round((p.x - grid.offsetX) / step) * step,
    y: grid.offsetY + Math.round((p.y - grid.offsetY) / step) * step,
  }
}

/** Corners of the "up" marker on the table view's top edge (corners from tableViewCorners). */
export function upMarker(corners: Point[], centre: Point, size: number): Point[] {
  const [a, b] = corners
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const len = Math.hypot(centre.x - mid.x, centre.y - mid.y)
  const inward = { x: (centre.x - mid.x) / len, y: (centre.y - mid.y) / len }
  const side = { x: -inward.y, y: inward.x }
  return [
    { x: mid.x + side.x * size, y: mid.y + side.y * size },
    { x: mid.x - side.x * size, y: mid.y - side.y * size },
    { x: mid.x + inward.x * size * 1.5, y: mid.y + inward.y * size * 1.5 },
  ]
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}
