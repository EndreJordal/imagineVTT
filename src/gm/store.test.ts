import { beforeEach, describe, expect, it } from 'vitest'
import { gmDarkness, useGm } from './store'

const lights = () => useGm.getState().scene.lights
const byKind = (kind: string) => lights().find((l) => l.kind === kind)!

describe('lights in the store', () => {
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        lights: [],
        view: { x: 0, y: 0 },
        map: { x: 0, y: 0, width: 1000, height: 1000, naturalWidth: 1000, naturalHeight: 1000 },
      },
      selectedLightIds: [],
    }))
  })

  it('adds hand-held lights unlit and fixed lights lit, and selects the new light', () => {
    useGm.getState().addLight('torch', { x: 10, y: 20 })
    expect(byKind('torch').on).toBe(false)
    expect(useGm.getState().selectedLightIds).toEqual([byKind('torch').id])
    useGm.getState().addLight('brazier', { x: 0, y: 0 })
    expect(byKind('brazier').on).toBe(true)
  })

  it('moves lights that travel with the table view, and only those', () => {
    const { addLight, updateLight, setView } = useGm.getState()
    addLight('lantern', { x: 100, y: 100 })
    addLight('candle', { x: 300, y: 300 })
    updateLight(byKind('lantern').id, { followView: true })

    setView({ x: 50, y: -20 })
    expect([byKind('lantern').x, byKind('lantern').y]).toEqual([150, 80])
    expect([byKind('candle').x, byKind('candle').y]).toEqual([300, 300])

    // Dragging it by hand still works, and it keeps following from there.
    updateLight(byKind('lantern').id, { x: 0, y: 0 })
    setView({ x: 60, y: -20 })
    expect([byKind('lantern').x, byKind('lantern').y]).toEqual([10, 0])
  })

  it('carries map lights along when the map moves or scales, but not party lights', () => {
    const { addLight, updateLight, setMapPosition, setMapScale } = useGm.getState()
    addLight('fixture', { x: 200, y: 300 })
    addLight('lantern', { x: 500, y: 500 })
    updateLight(byKind('lantern').id, { followView: true })

    setMapPosition({ x: 100, y: -50 })
    expect([byKind('fixture').x, byKind('fixture').y]).toEqual([300, 250])
    expect([byKind('lantern').x, byKind('lantern').y]).toEqual([500, 500])

    // Doubling the map's size keeps the fixture on the same spot of the image.
    setMapScale(2)
    expect([byKind('fixture').x, byKind('fixture').y]).toEqual([500, 550])
    expect([byKind('lantern').x, byKind('lantern').y]).toEqual([500, 500])
  })

  it('selects several lights with toggling, and edits, moves and removes them together', () => {
    const { addLight, toggleLightSelected, selectLight, updateLights, moveLights, removeLights } = useGm.getState()
    addLight('torch', { x: 0, y: 0 })
    addLight('flashlight', { x: 100, y: 0 })
    addLight('brazier', { x: 500, y: 500 })
    const [torch, flash, brazier] = lights().map((l) => l.id)
    const selected = () => useGm.getState().selectedLightIds

    selectLight(torch)
    toggleLightSelected(flash)
    expect(selected()).toEqual([torch, flash])
    toggleLightSelected(torch)
    expect(selected()).toEqual([flash])
    toggleLightSelected(torch)

    // A shared change, and one that only applies to cone lights.
    updateLights(selected(), { radius: 5 })
    updateLights(selected(), (l) => (l.kind === 'flashlight' ? { cone: 80 } : {}))
    expect([byKind('torch').radius, byKind('flashlight').radius, byKind('brazier').radius]).toEqual([5, 5, 6])
    expect([byKind('torch').cone, byKind('flashlight').cone]).toEqual([50, 80])

    moveLights(selected(), 10, -10)
    expect([byKind('torch').x, byKind('flashlight').x, byKind('brazier').x]).toEqual([10, 110, 500])

    removeLights(selected())
    expect(lights().map((l) => l.id)).toEqual([brazier])
    expect(selected()).toEqual([])
  })
})

describe('gmDarkness', () => {
  const scene = (darkness: number) => ({ ...useGm.getState().scene, darkness })

  it('spares the GM a fraction of the night, following the table', () => {
    expect(gmDarkness({ scene: scene(1), gmVision: 0.5, peeking: false })).toBe(0.5)
    expect(gmDarkness({ scene: scene(0.4), gmVision: 0.5, peeking: false })).toBeCloseTo(0.2)
    expect(gmDarkness({ scene: scene(1), gmVision: 1, peeking: false })).toBe(0)
    expect(gmDarkness({ scene: scene(1), gmVision: 0, peeking: false })).toBe(1)
  })

  it("shows exactly the players' darkness while peeking", () => {
    expect(gmDarkness({ scene: scene(0.9), gmVision: 1, peeking: true })).toBe(0.9)
  })
})

describe('fog of war', () => {
  const seen = (x: number, y: number) => {
    const { fogMemory: m, scene } = useGm.getState()
    const b = scene.map!
    const cx = Math.floor(((x - b.x) / b.width) * m!.cols)
    const cy = Math.floor(((y - b.y) / b.height) * m!.rows)
    return m!.data[cy * m!.cols + cx]
  }

  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        lights: [],
        grid: { ...s.scene.grid, size: 100 },
        map: { x: 0, y: 0, width: 5000, height: 5000, naturalWidth: 5000, naturalHeight: 5000 },
        fog: { enabled: false },
      },
      fogMemory: null,
      fogVersion: 0,
    }))
  })

  it('reveals around vision tokens (lit or not), and not around fixed lights', () => {
    const { addLight, setFogEnabled, updateLight } = useGm.getState()
    addLight('torch', { x: 1000, y: 1000 }) // unlit, but sees
    addLight('vision', { x: 4000, y: 1000 })
    addLight('fixture', { x: 1000, y: 4000 }) // lit, no vision
    updateLight(lights()[1].id, { visionRange: 5 })

    setFogEnabled(true)
    expect(seen(1000, 1000)).toBe(255)
    expect(seen(1000 + 1500, 1000)).toBe(255) // 15 squares: inside the torch's 20
    expect(seen(4000 + 700, 1000)).toBe(0) // beyond the vision token's 5
    expect(seen(1000, 4000)).toBe(0)
  })

  it('remembers where vision tokens have been, until reset', () => {
    const { addLight, setFogEnabled, updateLight, stampFog, resetFog } = useGm.getState()
    addLight('vision', { x: 500, y: 500 })
    updateLight(lights()[0].id, { visionRange: 3 })
    setFogEnabled(true)
    updateLight(lights()[0].id, { x: 3000, y: 3000 })
    stampFog() // the GM's sync does this on every scene change
    expect(seen(500, 500)).toBe(255) // still remembered
    expect(seen(3000, 3000)).toBe(255)

    resetFog()
    expect(seen(500, 500)).toBe(0) // forgotten
    expect(seen(3000, 3000)).toBe(255) // still in sight now
  })
})

