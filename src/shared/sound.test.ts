import { describe, expect, it } from 'vitest'
import { hearing, type SoundClips } from './sound'
import { usedClips } from './soundUse'

describe('sound', () => {
  const sound = { x: 0, y: 0, range: 5 }

  it('is heard louder nearer, by the nearest listener, and not beyond its range', () => {
    expect(hearing(sound, [{ x: 0, y: 0 }], 100)).toBe(1)
    const near = hearing(sound, [{ x: 100, y: 0 }], 100)
    const far = hearing(sound, [{ x: 400, y: 0 }], 100)
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
    expect(hearing(sound, [{ x: 500, y: 0 }], 100)).toBe(0)
    expect(hearing(sound, [{ x: 900, y: 0 }, { x: 100, y: 0 }], 100)).toBe(near)
    expect(hearing(sound, [], 100)).toBe(0)
  })

  it("keeps the clips a scene uses, with an ambience's layers", () => {
    const blob = new Blob()
    const clips: SoundClips = {
      amb: { name: 'Camp', duration: 0, takes: [], layers: [{ clip: 'fire', volume: 0.5, every: 0 }] },
      fire: { name: 'Fire', duration: 2, takes: [blob] },
      door: { name: 'Door', duration: 1, takes: [blob] },
      unused: { name: 'Unused', duration: 1, takes: [blob] },
    }
    const used = usedClips(
      { walls: [], globalSounds: [], doorSounds: { open: 'door', close: null, volume: 1 } },
      [[{ id: 's', name: 'Camp', clip: 'amb', x: 0, y: 0, volume: 1, range: 5, enabled: true, loop: true, trigger: 'manual' }]],
      clips,
    )
    expect([...used].sort()).toEqual(['amb', 'door', 'fire'])
  })
})
