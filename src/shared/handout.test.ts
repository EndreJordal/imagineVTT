import { describe, expect, it } from 'vitest'
import { HANDOUT_FRAME, HANDOUT_MARGIN, handoutBox, turnBy } from './handout'

describe('handouts', () => {
  const screen = { width: 1920, height: 1080 }

  it('fits the framed picture with the margin on the axis that limits it, centred', () => {
    const wide = handoutBox(screen, { width: 4000, height: 1000 }, 0)
    expect(wide.width).toBeCloseTo(screen.width - 2 * HANDOUT_MARGIN)
    expect(wide.height).toBeLessThan(screen.height - 2 * HANDOUT_MARGIN)
    const tall = handoutBox(screen, { width: 800, height: 1200 }, 0)
    expect(tall.height).toBeCloseTo(screen.height - 2 * HANDOUT_MARGIN)
    expect(tall.width - 2 * HANDOUT_FRAME).toBeCloseTo((tall.height - 2 * HANDOUT_FRAME) * (800 / 1200))
  })

  it('shows a small picture at its own size', () => {
    const small = handoutBox(screen, { width: 400, height: 300 }, 0)
    expect(small.scale).toBe(1)
    expect(small.width).toBe(400 + 2 * HANDOUT_FRAME)
  })

  it('fills the screen to the margin all round, enlarging and cropping', () => {
    const fill = handoutBox(screen, { width: 400, height: 400 }, 0, true)
    expect(fill.width).toBe(screen.width - 2 * HANDOUT_MARGIN)
    expect(fill.height).toBe(screen.height - 2 * HANDOUT_MARGIN)
    // Covers the frame: the wider side decides, the other is cropped.
    expect(fill.scale).toBeCloseTo((screen.width - 2 * (HANDOUT_MARGIN + HANDOUT_FRAME)) / 400)
  })

  it('swaps the sides when turned a quarter, and wraps turns', () => {
    const upright = handoutBox(screen, { width: 4000, height: 1000 }, 0)
    const sideways = handoutBox(screen, { width: 4000, height: 1000 }, 1)
    expect(sideways.height).toBeCloseTo(screen.height - 2 * HANDOUT_MARGIN)
    expect(sideways.width).toBeLessThan(upright.width)
    expect(turnBy(3, 1)).toBe(0)
    expect(turnBy(0, -1)).toBe(3)
    expect(turnBy(1, 2)).toBe(3)
  })
})
