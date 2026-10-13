import { sceneBounds, snapToGrid } from './geometry'
import { activeAreas, inArea } from './hidden'
import { emitsLight, LIGHT_PRESETS } from './lights'
import type { GridSettings, Point, Scene } from './types'
import { createVisibilityTest, visibilityPolygon, wallSegments } from './visibility'

/**
 * Character tokens: round tokens for the people the party meets (NPCs, monsters), framed by
 * a border, with a portrait inside. They fit their squares, with a little room to pick them
 * up, and slide where they're moved rather than jump.
 */
export type CharacterLabel = 'name' | 'type' | 'both' | 'none'

export interface CharacterToken {
  id: string
  name: string
  /** What kind of character it is ("Goblin archer"); shown under the name if chosen. */
  type?: string
  /** What's written at the bottom of its square(s); none if absent. */
  label?: CharacterLabel
  /** Centre, in scene units. */
  x: number
  y: number
  /** Squares across: 1, or 2 (filling 2 × 2). */
  size: 1 | 2
  /** A border picture's id (see BORDERS), or 'plain' (a ring in `color`). */
  border: string
  color: string
  /** The portrait: a key into the scene's images ('portrait:<path in the portraits folder>'). */
  portrait?: string
  /** Portrait zoom (1: fills the frame) and offset (fractions of the frame's width). */
  zoom: number
  offsetX: number
  offsetY: number
  /** Shown to the players (when they can see it). */
  visible: boolean
  /** Moves snap to the squares. */
  snap: boolean
  /** Seconds a move takes; the scene's (characterSlide) if absent. */
  slide?: number
  group?: string
}

/**
 * The border pictures (public/borders: rings cut out of their pictures by scripts/clean-borders.py),
 * with how far out the ring's inside edge is (fraction of the picture's half width).
 */
export const BORDERS: { id: string; name: string; inner: number }[] = [
  { id: 'gold', name: 'Gold', inner: 0.7761 },
  { id: 'glass', name: 'Glass', inner: 0.7854 },
  { id: 'iron-chain', name: 'Iron chain', inner: 0.664 },
  { id: 'iron-studs', name: 'Iron studs', inner: 0.6101 },
  { id: 'steel-spikes', name: 'Steel spikes', inner: 0.6924 },
  { id: 'black-iron', name: 'Black iron', inner: 0.6712 },
]

/** The portrait's radius inside a border, as a fraction of the token's radius. */
export function portraitRadius(border: string): number {
  const b = BORDERS.find((x) => x.id === border)
  // A touch under the ring, so no gap shows between them.
  return b ? b.inner + 0.02 : 1 - PLAIN_RING + 0.01
}

/** The label's lines, top to bottom: the name, then the type, as chosen (blank ones left out). */
export function labelLines(t: Pick<CharacterToken, 'name' | 'type' | 'label'>): { text: string; kind: 'name' | 'type' }[] {
  const label = t.label ?? 'none'
  const lines: { text: string; kind: 'name' | 'type' }[] = []
  if ((label === 'name' || label === 'both') && t.name.trim()) lines.push({ text: t.name.trim(), kind: 'name' })
  if ((label === 'type' || label === 'both') && t.type?.trim()) lines.push({ text: t.type.trim(), kind: 'type' })
  return lines
}

/** A move's slide, unless the scene or the token says otherwise (seconds). */
export const DEFAULT_SLIDE = 0.5

/** Room left between a token and its square's edge, on the table (mm). */
export const CLEARANCE_MM = 1

/** The plain border's ring, as a fraction of the token's radius; the portrait fills the rest. */
export const PLAIN_RING = 0.12

/** A token's diameter in scene units: its squares, less the clearance all round. */
export function tokenDiameter(t: Pick<CharacterToken, 'size'>, scene: Pick<Scene, 'grid' | 'squareMm'>): number {
  const mm = scene.grid.size / scene.squareMm
  return Math.max(scene.grid.size * 0.2, t.size * scene.grid.size - 2 * CLEARANCE_MM * mm)
}

/** Where a token moved to p settles: a square's middle (1 square) or a grid corner (2 × 2). */
export function snapToken(p: Point, size: 1 | 2, grid: GridSettings): Point {
  const off = size === 1 ? grid.size / 2 : 0
  const s = snapToGrid({ x: p.x - off, y: p.y - off }, grid, 1)
  return { x: s.x + off, y: s.y + off }
}

export const slideOf = (t: Pick<CharacterToken, 'slide'>, scene: Pick<Scene, 'characterSlide'>) =>
  t.slide ?? scene.characterSlide ?? DEFAULT_SLIDE

/**
 * The tokens the players can see: shown, and (with something obscured) in a vision token's
 * sight and lit (daylight, or a light that reaches it), outside hidden areas.
 */
export function seenTokens(scene: Scene): Set<string> {
  const tokens = (scene.characters ?? []).filter((t) => t.visible)
  if (scene.fog.mode === 'off' || !tokens.length) return new Set(tokens.map((t) => t.id))
  const segments = wallSegments(scene.walls)
  const test = (origin: Point, range: number) =>
    segments.length ? createVisibilityTest(origin, visibilityPolygon(origin, range, segments)) : () => true
  const seers = scene.lights
    .filter((l) => l.vision)
    .map((l) => {
      const range = l.visionRange * scene.grid.size
      return { x: l.x, y: l.y, range, sees: test(l, range) }
    })
  if (!seers.length) return new Set()
  // Daylight lights everything; at night, only lights do.
  const day = scene.darkness < 0.5
  const lights = day
    ? []
    : scene.lights
        .filter((l) => l.on && emitsLight(l))
        .map((l) => {
          const range = l.radius * scene.grid.size
          const cone = LIGHT_PRESETS[l.kind].shape === 'cone' ? (l.cone * Math.PI) / 360 : null
          return { l, range, cone, sees: test(l, range) }
        })
  const lit = (p: Point) =>
    day ||
    lights.some(({ l, range, cone, sees }) => {
      if (Math.hypot(p.x - l.x, p.y - l.y) > range) return false
      if (cone !== null) {
        const a = Math.atan2(p.y - l.y, p.x - l.x) - l.angle
        if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) > cone) return false
      }
      return sees(p)
    })
  const bounds = sceneBounds(scene)
  const hidden = activeAreas(scene)
  const seen = (p: Point) =>
    !hidden.some((a) => inArea(a, bounds, p)) &&
    seers.some((v) => Math.hypot(p.x - v.x, p.y - v.y) <= v.range && v.sees(p)) &&
    lit(p)
  return new Set(tokens.filter((t) => seen(t)).map((t) => t.id))
}
