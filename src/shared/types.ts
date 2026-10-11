import type { Light } from './lights'

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

/** Square grid in scene units. The grid is fixed; the map image is scaled to fit it. */
export interface GridSettings {
  size: number
  offsetX: number
  offsetY: number
  visible: boolean
  /** Line colour as '#rrggbb'. */
  color: string
  /** Line opacity, 0..1. */
  opacity: number
}

/** The map image as placed in the scene: its top-left corner and displayed size. */
export interface MapInfo extends Rect {
  /** Pixel size of the image file; width/height are its displayed size in scene units. */
  naturalWidth: number
  naturalHeight: number
  /** Stop dragging from moving the map along this axis. */
  lockX?: boolean
  lockY?: boolean
  /**
   * Map and grid move (and scale) together, so a grid matched to the map stays matched.
   * The map's own size can't be changed directly while this is on.
   */
  lockToGrid?: boolean
}

export interface Scene {
  /** Map image placement; null means a blank grid. */
  map: MapInfo | null
  grid: GridSettings
  /** Physical size of one grid square on the table, in mm (1" = 25.4). */
  squareMm: number
  /** Map-space centre of what the table display shows. */
  view: Point
  /** Time of day, 0 (day: map as drawn) to 1 (night: dimmed and desaturated). */
  darkness: number
  /** Light sources; they light up the map at night. */
  lights: Light[]
}

export type Orientation = 0 | 90 | 180 | 270

/** Properties of the physical table display, independent of the scene. */
export interface Display {
  /** CSS pixels per millimetre on the table screen, set by calibration. */
  pxPerMm: number
  /** Which way the table view is rotated relative to the map. */
  orientation: Orientation
}

/** Everything the table window needs to render (except the map image blob). */
export interface TableState {
  scene: Scene
  display: Display
  calibrating: boolean
}
