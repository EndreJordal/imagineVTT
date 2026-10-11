import { describe, expect, it } from 'vitest'
import { animateLight, createLight, isDirectional, LIGHT_MENU, LIGHT_PRESETS, seedOf, type Animation } from './lights'

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

  it('has faulty fixtures mostly on, with occasional dropouts', () => {
    const b = sample('faultyFixture', 0.1, 60).map((f) => f.brightness)
    const dark = b.filter((v) => v < 0.5).length / b.length
    expect(dark).toBeGreaterThan(0)
    expect(dark).toBeLessThan(0.1)
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
