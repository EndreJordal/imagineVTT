import type { MapInfo, Point } from './types'
import { carryPoint } from './geometry'

/** An image placed on the map (from the asset library), drawn on the map under night and fog. */
export interface MapObject {
  id: string
  /** Asset key (library path, e.g. "Fantasy/Objects/Trees/Tree 1"); its image is in AssetImages. */
  asset: string
  name: string
  /** Centre, size and rotation (radians, clockwise), in scene units. */
  x: number
  y: number
  width: number
  height: number
  rotation: number
  /** How the players see it when something is obscured (see ObjectVisibility); absent: 'map'. */
  visibility?: ObjectVisibility
  /** The group it's in (see Scene.groups). */
  group?: string
  /** 'seen' objects: a vision token has seen it. 'hidden' ones: the GM has shown it. */
  seen?: boolean
}

/**
 * How the players see an object: like the map (greyscale out of sight, hidden where
 * unexplored), only while a vision token sees it ('sight'), not until one has, then like the
 * map ('seen'), or not until the GM shows it, obscured or not ('hidden').
 */
export type ObjectVisibility = 'map' | 'sight' | 'seen' | 'hidden'

/**
 * An asset's image, kept with the scene (so placed objects don't need the library): a still
 * image, or for animations a sprite sheet of all frames.
 */
export interface AssetImage {
  image: Blob
  /** The original frame size in px (for default sizes). */
  width: number
  height: number
  /** Animations: frames laid out left to right, top to bottom, each `pad` px from its cell edge. */
  frames?: { count: number; cols: number; rows: number; fps: number; frameWidth: number; frameHeight: number; pad: number }
}

export type AssetImages = Record<string, AssetImage>

/** The four corners of an object (top-left, top-right, bottom-right, bottom-left, before rotation). */
export function objectCorners(o: Pick<MapObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>): Point[] {
  const c = Math.cos(o.rotation)
  const s = Math.sin(o.rotation)
  const hw = o.width / 2
  const hh = o.height / 2
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([dx, dy]) => ({ x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c }))
}

/** Point p in the object's own frame (unrotated, relative to its centre). */
function toObjectFrame(o: MapObject, p: Point): Point {
  const c = Math.cos(-o.rotation)
  const s = Math.sin(-o.rotation)
  const dx = p.x - o.x
  const dy = p.y - o.y
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

/** Whether p is on the object, with `slack` scene units of tolerance. */
export function hitsObject(o: MapObject, p: Point, slack = 0): boolean {
  const q = toObjectFrame(o, p)
  return Math.abs(q.x) <= o.width / 2 + slack && Math.abs(q.y) <= o.height / 2 + slack
}

/** Objects go with the map when it's moved or resized: position and size. */
export function carryObject(o: MapObject, from: MapInfo, to: MapInfo): MapObject {
  const k = to.width / from.width
  return { ...o, ...carryPoint(o, from, to), width: o.width * k, height: o.height * k }
}
