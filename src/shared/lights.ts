/**
 * Light sources and vision tokens: presets for each kind, and light flicker animation.
 * A vision token is a "light" with no light (shape 'none'): it only lets the party see.
 */

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
  | 'vision'

export interface Light {
  id: string
  kind: LightKind
  /** "Torch 1"; absent in lights placed before names: the kind's label. */
  name?: string
  /** The group it's in (see Scene.groups). */
  group?: string
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
  /** Moves along when the GM moves the table view (hand-held lights carried by the party). */
  followView?: boolean
  /** Breaks fog of war around it: the party sees from here. */
  vision: boolean
  /** How far it sees, in grid squares. */
  visionRange: number
  /** Flicker settings, for flickering lights (see Flicker); the preset's if absent. */
  flicker?: Flicker
  /** How strongly it bathes what it lights in its colour, 0..1 (DEFAULT_COLOR_STRENGTH if absent). */
  colorStrength?: number
  /** Flames: steady (0) to erratic (1); 0.5 if absent. */
  liveliness?: number
}

/** Lights' colour strength unless set: a light tint (beyond it, the colour bathes the map). */
export const DEFAULT_COLOR_STRENGTH = 0.32

/** Whether a light burns (its flame's liveliness can be set). */
export const isFlame = (l: Pick<Light, 'kind'>) => ['fire', 'candle', 'lantern'].includes(LIGHT_PRESETS[l.kind].animation)

/**
 * How a flickering light (failing fixture, buzzing neon) misbehaves. Every so often it
 * stutters for a moment: down to a lower brightness, up past its brightness, or (with both
 * on) either. Brightness values are 0..1, like Light.intensity.
 */
export interface Flicker {
  /** Flickers per minute, on average. */
  rate: number
  /** Dips: brightness drops to this level. */
  low: { on: boolean; level: number }
  /** Surges: this much is added to the light's brightness. */
  high: { on: boolean; boost: number }
}

const DEFAULT_FLICKER: Flicker = { rate: 20, low: { on: true, level: 0 }, high: { on: false, boost: 0.3 } }

/** How a light's brightness behaves over time. */
export type Animation = 'steady' | 'fire' | 'candle' | 'lantern' | 'flicker'

/** How the light spreads: round, a cone, along a tube, or not at all (vision only). */
export type Shape = 'radial' | 'cone' | 'tube' | 'none'

/** Light kinds share a few icons (the token's ring, in the light's colour, tells them apart). */
export type LightIcon = 'lamp' | 'fire' | 'flashlight' | 'eye'

export interface LightPreset {
  label: string
  icon: LightIcon
  /** Hand-held: meant to be carried around. */
  handheld: boolean
  shape: Shape
  animation: Animation
  radius: number
  color: string
  intensity: number
  cone?: number
  /** Vision when placed (default: on for hand-held lights) and its range in squares. */
  vision?: boolean
  visionRange?: number
  /** Flickering lights: default flicker settings. */
  flicker?: Flicker
  /** A faint constant buzz between flickers (neon). */
  buzz?: boolean
}

/** Hand-held lights see this far by default (100ft in 5ft squares). */
export const DEFAULT_VISION_RANGE = 20

/** Points somewhere (flashlight beam, neon tube); everything else, vision included, is all-round. */
export const isDirectional = (light: Light) => {
  const shape = LIGHT_PRESETS[light.kind].shape
  return shape === 'cone' || shape === 'tube'
}

/** Radii roughly follow 5e (squares of 5ft): a torch lights 20ft bright + 20ft dim. */
export const LIGHT_PRESETS: Record<LightKind, LightPreset> = {
  fixture: { label: 'Light fixture', icon: 'lamp', handheld: false, shape: 'radial', animation: 'steady', radius: 7, color: '#fff4e0', intensity: 0.95 },
  fixtureFlicker: { label: 'Light fixture (flickering)', icon: 'lamp', handheld: false, shape: 'radial', animation: 'flicker', radius: 7, color: '#f2f6ff', intensity: 0.9, flicker: DEFAULT_FLICKER },
  neon: { label: 'Neon', icon: 'lamp', handheld: false, shape: 'tube', animation: 'steady', radius: 4, color: '#ff3fd2', intensity: 0.9 },
  neonFlicker: { label: 'Neon (flickering)', icon: 'lamp', handheld: false, shape: 'tube', animation: 'flicker', radius: 4, color: '#3fe8ff', intensity: 0.9, flicker: { ...DEFAULT_FLICKER, rate: 26 }, buzz: true },
  brazier: { label: 'Brazier', icon: 'fire', handheld: false, shape: 'radial', animation: 'fire', radius: 6, color: '#ff9a40', intensity: 0.95 },
  torch: { label: 'Torch', icon: 'fire', handheld: true, shape: 'radial', animation: 'fire', radius: 8, color: '#ff9440', intensity: 0.9 },
  campfire: { label: 'Camp fire', icon: 'fire', handheld: false, shape: 'radial', animation: 'fire', radius: 9, color: '#ff8a30', intensity: 1 },
  candle: { label: 'Candle', icon: 'fire', handheld: true, shape: 'radial', animation: 'candle', radius: 2.5, color: '#ffb766', intensity: 0.8 },
  flashlight: { label: 'Flashlight', icon: 'flashlight', handheld: true, shape: 'cone', animation: 'steady', radius: 12, color: '#f4f8ff', intensity: 0.95, cone: 50 },
  lantern: { label: 'Lantern', icon: 'fire', handheld: true, shape: 'radial', animation: 'lantern', radius: 10, color: '#ffc070', intensity: 0.9 },
  // Placed switched off at the smallest range, so the GM opens it up deliberately.
  vision: { label: 'Vision token', icon: 'eye', handheld: true, shape: 'none', animation: 'steady', radius: 0, color: '#9ad0ff', intensity: 0, vision: false, visionRange: 1 },
}

/** A light's flicker settings (flickering lights only). */
export function flickerOf(light: Light): Flicker | undefined {
  return light.flicker ?? LIGHT_PRESETS[light.kind].flicker
}

/** Gives light (as opposed to a pure vision token). */
export const emitsLight = (light: Light) => LIGHT_PRESETS[light.kind].shape !== 'none'

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
  { kind: 'vision', label: 'Vision token (no light)' },
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
    // Hand-held lights start unlit so the GM decides when the party lights them.
    on: !p.handheld,
    // What the party carries is where they see from.
    vision: p.vision ?? p.handheld,
    visionRange: p.visionRange ?? DEFAULT_VISION_RANGE,
    ...(p.flicker && { flicker: structuredClone(p.flicker) }),
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

/** What the 'flicker' animation needs to know about the light. */
export interface FlickerInput {
  flicker: Flicker
  /** The light's brightness (0..1), to turn levels into multipliers. */
  intensity: number
  buzz: boolean
}

/**
 * Animation at time t (seconds). `seed` decorrelates lights so a row of torches doesn't
 * flicker in unison. Fire is layered smooth noise (a slow sway plus fast licks); flickering
 * lights are steady with occasional stutters, as configured.
 */
export function animateLight(
  animation: Animation,
  t: number,
  seed: number,
  flicker?: FlickerInput,
  liveliness = 0.5,
): LightFrame {
  // Liveliness scales a flame's swings (0.15x steady .. 1x at 0.5 .. 2.6x erratic) and pace.
  const l = Math.min(1, Math.max(0, liveliness))
  const amp = l <= 0.5 ? 0.15 + 1.7 * l : 1 + 3.2 * (l - 0.5)
  const pace = 0.6 + 0.8 * l
  const n = (speed: number, offset: number) => smoothNoise(t * speed * pace + seed * 17.3 + offset)
  const c = (speed: number, offset: number) => n(speed, offset) - 0.5
  // Erratic flames now and then gutter, as if in a draught.
  const gust = () => 1 - 0.45 * Math.max(0, 2 * l - 1) * Math.max(0, n(0.7, 500) - 0.7) * 3.3
  switch (animation) {
    case 'steady':
      return STEADY
    case 'fire': {
      const sway = c(1.3, 0) // slow breathing of the flame
      const lick = c(7, 50) // fast flicker
      const crackle = c(19, 90)
      return {
        brightness: Math.max(0.2, (0.92 + amp * (0.1 * sway + 0.07 * lick + 0.03 * crackle)) * gust()),
        reach: 0.98 + amp * (0.04 * sway + 0.02 * lick),
        dx: amp * 0.012 * c(2.1, 200),
        dy: amp * 0.012 * c(2.4, 300),
      }
    }
    case 'candle': {
      const sway = c(0.9, 0)
      const lick = c(5, 40)
      return {
        brightness: Math.max(0.2, (0.925 + amp * (0.08 * sway + 0.05 * lick)) * gust()),
        reach: 0.985 + amp * 0.03 * sway,
        dx: amp * 0.01 * c(1.6, 200),
        dy: amp * 0.01 * c(1.9, 300),
      }
    }
    case 'lantern':
      return {
        brightness: Math.max(0.2, (0.975 + amp * (0.04 * c(1.1, 0) + 0.01 * c(6, 30))) * gust()),
        reach: 1,
        dx: 0,
        dy: 0,
      }
    case 'flicker':
      return flickerFrame(t, seed, flicker)
  }
}

/** Longest a single flicker lasts, in seconds (it stutters throughout). */
const FLICKER_MAX_SECONDS = 0.45

/**
 * Configurable flicker. Time is cut into slots of 60/rate seconds; each slot holds one
 * flicker at a random moment, lasting a random fraction of a second, during which the light
 * stutters between its own brightness and the flicker's (a dip, a surge, or either).
 */
function flickerFrame(t: number, seed: number, input?: FlickerInput): LightFrame {
  if (!input) return STEADY
  const { flicker: f, intensity, buzz } = input
  const base = buzz ? 0.95 + 0.05 * smoothNoise(t * 40 + seed * 17.3) : 1
  const kinds = [f.low.on && 'low', f.high.on && 'high'].filter((k) => !!k)
  if (!kinds.length || f.rate <= 0 || intensity <= 0) return { ...STEADY, brightness: base }

  const period = 60 / f.rate
  const position = t / period + seed * 7
  const slot = Math.floor(position)
  const within = (position - slot) * period // seconds into this slot
  const duration = Math.min(period, (0.08 + hash(slot * 3 + 2) * (FLICKER_MAX_SECONDS - 0.08)))
  const start = hash(slot * 3 + 1) * (period - duration)
  if (within < start || within >= start + duration) return { ...STEADY, brightness: base }

  // Stutter: flip between the flicker level and normal, about 18 times a second.
  if (hash(Math.floor(t * 18) * 7 + slot * 13) >= 0.65) return { ...STEADY, brightness: base }
  const kind = kinds.length === 2 ? (hash(slot * 3 + 3) < 0.5 ? 'low' : 'high') : kinds[0]
  const level = kind === 'low' ? f.low.level : intensity + f.high.boost
  return { ...STEADY, brightness: level / intensity }
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

/** A light's name (lights placed before names go by their kind). */
export const lightName = (l: Light) => l.name ?? LIGHT_PRESETS[l.kind].label
