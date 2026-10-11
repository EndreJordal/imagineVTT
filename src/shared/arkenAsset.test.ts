import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultSquares, parseAssetFrames, parseAssetMeta, pngSize } from './arkenAsset'
import { carryObject, hitsObject, objectCorners, type MapObject } from './mapObjects'

describe('defaultSquares', () => {
  it('sizes images the way Arkenforge does: 200 px per square, times their scale', () => {
    expect(defaultSquares('Objects', 128, 256, { x: 1.5625, y: 1.5625 })).toEqual({ width: 1, height: 2 })
  })

  it('gives textures (tiling fills, with no real size) a few squares', () => {
    const t = defaultSquares('Textures', 1024, 512, { x: 72, y: 72 })
    expect(t.width).toBeCloseTo(4)
    expect(t.height).toBeCloseTo(2)
  })
})

describe('objects on the map', () => {
  const o: MapObject = { id: 'o', asset: 'a', name: 'a', x: 100, y: 100, width: 40, height: 20, rotation: Math.PI / 2 }

  it('has its corners rotated about its centre', () => {
    const [tl, tr] = objectCorners(o)
    expect(tl.x).toBeCloseTo(110)
    expect(tl.y).toBeCloseTo(80)
    expect(tr.x).toBeCloseTo(110)
    expect(tr.y).toBeCloseTo(120)
  })

  it('is hit within its rotated rectangle', () => {
    expect(hitsObject(o, { x: 105, y: 118 })).toBe(true) // inside, turned upright
    expect(hitsObject(o, { x: 118, y: 105 })).toBe(false) // inside the unrotated box only
  })

  it('moves and scales with the map', () => {
    const from = { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 }
    const to = { ...from, x: 50, width: 2000, height: 2000 }
    expect(carryObject(o, from, to)).toMatchObject({ x: 250, y: 200, width: 80, height: 40, rotation: Math.PI / 2 })
  })
})

const DIR = 'media-assets/Fantasy/Objects'
describe.skipIf(!existsSync(DIR))('real Arkenforge assets', () => {
  it('reads a still image and its entry', () => {
    const meta = parseAssetMeta(readFileSync(`${DIR}/Treasure/Crown (silver).rwmeta`))
    expect(meta.name).toBe('Crown (silver)')
    expect(meta.thumbnail).not.toBeNull()
    expect(meta.scale.x).toBeCloseTo(0.355, 3)
    const frames = parseAssetFrames(readFileSync(`${DIR}/Treasure/Crown (silver).rwfile`))
    expect(frames.map(pngSize)).toEqual([{ width: 167, height: 177 }])
  })

  it('reads every frame of an animation (old and new layouts)', () => {
    expect(parseAssetFrames(readFileSync(`${DIR}/Treasure/Treasure pileAnimated.rwfile`))).toHaveLength(58)
    expect(parseAssetMeta(readFileSync(`${DIR}/Animated effects/Fire/Wall fire.rwmeta`)).frames).toBe(229)
    expect(parseAssetFrames(readFileSync(`${DIR}/Animated effects/Fire/Wall fire.rwfile`))).toHaveLength(229)
  })
})
