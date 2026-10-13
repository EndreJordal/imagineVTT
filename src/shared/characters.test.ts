import { describe, expect, it } from 'vitest'
import { defaultScene } from '../gm/slices/shared'
import { seenTokens, snapToken, tokenDiameter, type CharacterToken } from './characters'
import { createLight } from './lights'
import type { Scene } from './types'

const token = (over: Partial<CharacterToken> = {}): CharacterToken => ({
  id: 't',
  name: 'Goblin',
  x: 150,
  y: 150,
  size: 1,
  border: 'gold',
  color: '#ff0000',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  visible: true,
  snap: true,
  ...over,
})

const grid = { size: 100, offsetX: 0, offsetY: 0, visible: true, color: '#000000', opacity: 1 }

describe('character tokens', () => {
  it('fills its squares less a millimetre all round', () => {
    const scene = { grid, squareMm: 25 }
    expect(tokenDiameter({ size: 1 }, scene)).toBeCloseTo(100 - 2 * (100 / 25))
    expect(tokenDiameter({ size: 2 }, scene)).toBeCloseTo(200 - 2 * (100 / 25))
  })

  it('settles in a square (1) or on a grid corner (2 × 2)', () => {
    expect(snapToken({ x: 130, y: 260 }, 1, grid)).toEqual({ x: 150, y: 250 })
    expect(snapToken({ x: 130, y: 260 }, 2, grid)).toEqual({ x: 100, y: 300 })
  })

  describe('who the players see', () => {
    const vision = { ...createLight('vision', 100, 100, 'v'), vision: true, visionRange: 10 }
    const base = (over: Partial<Scene>): Scene => ({
      ...defaultScene,
      grid,
      walls: [],
      lights: [vision],
      fog: { ...defaultScene.fog, mode: 'full' },
      characters: [token()],
      ...over,
    })

    it('shows all visible tokens when nothing is obscured; never hidden ones', () => {
      expect(seenTokens(base({ fog: { ...defaultScene.fog, mode: 'off' }, lights: [] }))).toEqual(new Set(['t']))
      expect(seenTokens(base({ characters: [token({ visible: false })], darkness: 0 }))).toEqual(new Set())
    })

    it('needs sight, and light: daylight or a lit light reaching it', () => {
      expect(seenTokens(base({ darkness: 0 }))).toEqual(new Set(['t']))
      expect(seenTokens(base({ darkness: 1 }))).toEqual(new Set()) // in sight, but dark
      const torch = { ...createLight('torch', 200, 200, 'l'), on: true }
      expect(seenTokens(base({ darkness: 1, lights: [vision, torch] }))).toEqual(new Set(['t']))
      expect(seenTokens(base({ darkness: 0, lights: [] }))).toEqual(new Set()) // nobody looking
      // Behind a wall from the only seer.
      const wall = { id: 'w', points: [{ x: 125, y: 0 }, { x: 125, y: 400 }] }
      expect(seenTokens(base({ darkness: 0, walls: [wall] }))).toEqual(new Set())
    })
  })
})
