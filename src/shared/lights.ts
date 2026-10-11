/** Light sources: presets for each kind, and their flicker animation. */

export type LightKind =
  | 'fixture'
  | 'fixtureFlicker'
  | 'neon'
  | 'neonFlicker'
  | 'brazier'
  | 'torch'
  | 'campfire'
  | 'candle'
  | 'flashlight'
  | 'lantern'

export interface Light {
  id: string
  kind: LightKind
  /** Scene position. */
  x: number
  y: number
  /** Reach in grid squares. */
  radius: number
  /** '#rrggbb' */
  color: string
  /** 0..1 */
  intensity: number
  /** Direction in radians (0 = right): where a flashlight points, how a neon tube lies. */
  angle: number
  /** Full cone width in degrees (flashlight only). */
  cone: number
  on: boolean
}

/** How a light's brightness behaves over time. */
export type Animation = 'steady' | 'fire' | 'candle' | 'lantern' | 'faultyFixture' | 'faultyNeon'

/** How the light spreads: round, a cone, or along a tube. */
export type Shape = 'radial' | 'cone' | 'tube'

export interface LightPreset {
  label: string
  icon: string
  /** Hand-held: meant to be carried around. */
  handheld: boolean
  shape: Shape
  animation: Animation
  radius: number
  color: string
  intensity: number
  cone?: number
}

/** Radii roughly follow 5e (squares of 5ft): a torch lights 20ft bright + 20ft dim. */
export const LIGHT_PRESETS: Record<LightKind, LightPreset> = {
  fixture: { label: 'Light fixture', icon: '💡', handheld: false, shape: 'radial', animation: 'steady', radius: 7, color: '#fff4e0', intensity: 0.95 },
  fixtureFlicker: { label: 'Light fixture (flickering)', icon: '💡', handheld: false, shape: 'radial', animation: 'faultyFixture', radius: 7, color: '#f2f6ff', intensity: 0.9 },
  neon: { label: 'Neon', icon: '🔆', handheld: false, shape: 'tube', animation: 'steady', radius: 4, color: '#ff3fd2', intensity: 0.9 },
  neonFlicker: { label: 'Neon (flickering)', icon: '🔆', handheld: false, shape: 'tube', animation: 'faultyNeon', radius: 4, color: '#3fe8ff', intensity: 0.9 },
  brazier: { label: 'Brazier', icon: '⚱️', handheld: false, shape: 'radial', animation: 'fire', radius: 6, color: '#ff9a40', intensity: 0.95 },
  torch: { label: 'Torch', icon: '🔥', handheld: true, shape: 'radial', animation: 'fire', radius: 8, color: '#ff9440', intensity: 0.9 },
  campfire: { label: 'Camp fire', icon: '🏕️', handheld: false, shape: 'radial', animation: 'fire', radius: 9, color: '#ff8a30', intensity: 1 },
  candle: { label: 'Candle', icon: '🕯️', handheld: true, shape: 'radial', animation: 'candle', radius: 2.5, color: '#ffb766', intensity: 0.8 },
  flashlight: { label: 'Flashlight', icon: '🔦', handheld: true, shape: 'cone', animation: 'steady', radius: 12, color: '#f4f8ff', intensity: 0.95, cone: 50 },
  lantern: { label: 'Lantern', icon: '🏮', handheld: true, shape: 'radial', animation: 'lantern', radius: 10, color: '#ffc070', intensity: 0.9 },
}

/** Menu order: modern lights first, then fire, then hand-held. */
export const LIGHT_MENU: { kind: LightKind; label: string }[] = [
  { kind: 'fixture', label: 'Modern – light fixture' },
  { kind: 'fixtureFlicker', label: 'Modern – light fixture, flickering' },
  { kind: 'neon', label: 'Modern – neon' },
  { kind: 'neonFlicker', label: 'Modern – neon, flickering' },
  { kind: 'flashlight', label: 'Modern – flashlight' },
  { kind: 'brazier', label: 'Brazier' },
  { kind: 'campfire', label: 'Camp fire' },
  { kind: 'torch', label: 'Torch' },
  { kind: 'lantern', label: 'Lantern' },
  { kind: 'candle', label: 'Candle' },
]

export function createLight(kind: LightKind, x: number, y: number, id: string): Light {
  const p = LIGHT_PRESETS[kind]
  return {
    id,
    kind,
    x,
    y,
    radius: p.radius,
    color: p.color,
    intensity: p.intensity,
    angle: 0,
    cone: p.cone ?? 50,
    on: true,
  }
}

/** A light's state at one moment: multipliers on its configured values. */
export interface LightFrame {
  /** Brightness multiplier (0..~1.1). */
  brightness: number
  /** Radius multiplier. */
  reach: number
  /** Flame wobble, in fractions of the radius. */
  dx: number
  dy: number
}

const STEADY: LightFrame = { brightness: 1, reach: 1, dx: 0, dy: 0 }

/**
 * Animation at time t (seconds). `seed` decorrelates lights so a row of torches doesn't
 * flicker in unison. Fire is layered smooth noise (a slow sway plus fast licks); faulty
 * lights are steady with occasional dropouts.
 */
export function animateLight(animation: Animation, t: number, seed: number): LightFrame {
  const n = (speed: number, offset: number) => smoothNoise(t * speed + seed * 17.3 + offset)
  switch (animation) {
    case 'steady':
      return STEADY
    case 'fire': {
      const sway = n(1.3, 0) // slow breathing of the flame
      const lick = n(7, 50) // fast flicker
      const crackle = n(19, 90)
      return {
        brightness: 0.82 + 0.1 * sway + 0.07 * lick + 0.03 * crackle,
        reach: 0.95 + 0.04 * sway + 0.02 * lick,
        dx: 0.012 * (n(2.1, 200) - 0.5),
        dy: 0.012 * (n(2.4, 300) - 0.5),
      }
    }
    case 'candle': {
      const sway = n(0.9, 0)
      const lick = n(5, 40)
      return {
        brightness: 0.86 + 0.08 * sway + 0.05 * lick,
        reach: 0.97 + 0.03 * sway,
        dx: 0.01 * (n(1.6, 200) - 0.5),
        dy: 0.01 * (n(1.9, 300) - 0.5),
      }
    }
    case 'lantern':
      return { brightness: 0.95 + 0.04 * n(1.1, 0) + 0.01 * n(6, 30), reach: 1, dx: 0, dy: 0 }
    case 'faultyFixture': {
      // Mostly on; every few seconds a burst of stutters, sometimes a longer blackout.
      const cycle = Math.floor(t / 3.1 + seed)
      const phase = t / 3.1 + seed - cycle
      const unlucky = hash(cycle) < 0.55
      if (unlucky && phase < 0.12) {
        const stutter = hash(Math.floor(t * 22) + cycle * 13) < 0.5
        return { ...STEADY, brightness: stutter ? 0.15 : 0.9 }
      }
      return { ...STEADY, brightness: 0.97 + 0.03 * n(30, 0) }
    }
    case 'faultyNeon': {
      // A constant faint buzz, and the odd moment where the tube drops out and catches.
      const buzz = 0.93 + 0.07 * n(40, 0)
      const cycle = Math.floor(t / 2.3 + seed)
      const phase = t / 2.3 + seed - cycle
      if (hash(cycle + 7) < 0.45 && phase < 0.08) {
        return { ...STEADY, brightness: hash(Math.floor(t * 30)) < 0.6 ? 0.05 : buzz }
      }
      return { ...STEADY, brightness: buzz }
    }
  }
}

/** Deterministic hash of an integer to [0, 1). */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** 1D value noise in [0, 1], smoothly interpolated. */
function smoothNoise(x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i) * (1 - u) + hash(i + 1) * u
}

/** A stable number for a light id, so its flicker pattern is its own. */
export function seedOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (h >>> 0) / 2 ** 32
}
