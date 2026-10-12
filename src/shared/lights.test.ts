import { describe, expect, it } from 'vitest'
import {
  animateLight,
  createLight,
  isDirectional,
  LIGHT_MENU,
  LIGHT_PRESETS,
  seedOf,
  type Animation,
  type Flicker,
} from './lights'

const sample = (animation: Animation, seed = 0.3, seconds = 20, fps = 60) =>
  Array.from({ length: seconds * fps }, (_, i) => animateLight(animation, i / fps, seed))

describe('animateLight', () => {
  it('keeps steady lights constant', () => {
    expect(new Set(sample('steady').map((f) => f.brightness))).toEqual(new Set([1]))
  })

  it('makes fire flicker within a believable range, without jumps between frames', () => {
    const frames = sample('fire')
    const b = frames.map((f) => f.brightness)
    expect(Math.min(...b)).toBeGreaterThan(0.7)
    expect(Math.max(...b)).toBeLessThan(1.05)
    expect(Math.max(...b) - Math.min(...b)).toBeGreaterThan(0.1) // visibly alive
    const steps = b.slice(1).map((v, i) => Math.abs(v - b[i]))
    expect(Math.max(...steps)).toBeLessThan(0.05) // smooth at 60fps
  })

  it('gives each light its own flicker', () => {
    const a = sample('fire', seedOf('light-a')).map((f) => f.brightness)
    const b = sample('fire', seedOf('light-b')).map((f) => f.brightness)
    expect(a).not.toEqual(b)
  })

  it('makes flames steadier or wilder with liveliness', () => {
    const spread = (liveliness: number) => {
      const b = Array.from({ length: 1200 }, (_, i) => animateLight('fire', i / 60, 0.3, undefined, liveliness).brightness)
      return Math.max(...b) - Math.min(...b)
    }
    expect(spread(0)).toBeLessThan(spread(0.5) / 3)
    expect(spread(1)).toBeGreaterThan(spread(0.5) * 2)
    expect(spread(0.5)).toBeCloseTo(
      (() => {
        const b = sample('fire').map((f) => f.brightness)
        return Math.max(...b) - Math.min(...b)
      })(),
      6,
    )
  })

})

describe('configurable flicker', () => {
  const run = (flicker: Flicker, intensity = 0.5, seconds = 120, fps = 60) =>
    Array.from({ length: seconds * fps }, (_, i) =>
      animateLight('flicker', i / fps, 0.37, { flicker, intensity, buzz: false }).brightness * intensity,
    )
  const off = { on: false, level: 0 }
  const noSurge = { on: false, boost: 0.3 }

  it('dips to the low level now and then, and is otherwise at its brightness', () => {
    const levels = new Set(run({ rate: 20, low: { on: true, level: 0.1 }, high: noSurge }).map((v) => v.toFixed(3)))
    expect(levels).toEqual(new Set(['0.500', '0.100']))
  })

  it('surges by the boost when flickering up', () => {
    const b = run({ rate: 20, low: off, high: { on: true, boost: 0.3 } })
    expect(Math.max(...b)).toBeCloseTo(0.8) // 50% + 30
    expect(Math.min(...b)).toBeCloseTo(0.5)
  })

  it('flickers more often at a higher rate, and not at all with both kinds off', () => {
    const share = (rate: number) => {
      const b = run({ rate, low: { on: true, level: 0 }, high: noSurge })
      return b.filter((v) => v < 0.25).length / b.length
    }
    expect(share(60)).toBeGreaterThan(share(10) * 2)
    expect(new Set(run({ rate: 60, low: off, high: noSurge }))).toEqual(new Set([0.5]))
  })

  it('does both kinds when both are on', () => {
    const b = run({ rate: 60, low: { on: true, level: 0 }, high: { on: true, boost: 0.4 } })
    expect(Math.min(...b)).toBeCloseTo(0)
    expect(Math.max(...b)).toBeCloseTo(0.9)
  })
})

describe('createLight', () => {
  it('places hand-held lights unlit and seeing, and vision tokens switched off at 1 square', () => {
    const torch = createLight('torch', 0, 0, 't')
    expect([torch.on, torch.vision, torch.visionRange]).toEqual([false, true, 20])
    const eye = createLight('vision', 0, 0, 'v')
    expect([eye.vision, eye.visionRange]).toEqual([false, 1])
    expect(createLight('brazier', 0, 0, 'b').vision).toBe(false)
  })

  it('gives only beams and tubes a direction', () => {
    const directional = (Object.keys(LIGHT_PRESETS) as (keyof typeof LIGHT_PRESETS)[])
      .filter((k) => isDirectional(createLight(k, 0, 0, k)))
      .sort()
    expect(directional).toEqual(['flashlight', 'neon', 'neonFlicker'])
  })
})

describe('presets', () => {
  it('lists every kind once in the menu', () => {
    expect(LIGHT_MENU.map((m) => m.kind).sort()).toEqual(Object.keys(LIGHT_PRESETS).sort())
  })

  it('marks the carried lights as hand-held', () => {
    const handheld = Object.entries(LIGHT_PRESETS)
      .filter(([, p]) => p.handheld)
      .map(([k]) => k)
      .sort()
    expect(handheld).toEqual(['candle', 'flashlight', 'lantern', 'torch', 'vision'])
  })
})
