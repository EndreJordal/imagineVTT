import { beforeEach, describe, expect, it } from 'vitest'
import { createLight } from '../shared/lights'
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

  it("follows the players' darkness until set apart, then keeps its own", () => {
    expect(gmDarkness({ scene: scene(0.7), gmView: null, peeking: false })).toBe(0.7)
    expect(gmDarkness({ scene: scene(0.2), gmView: 0.9, peeking: false })).toBe(0.9)
    expect(gmDarkness({ scene: scene(1), gmView: 0, peeking: false })).toBe(0)
  })

  it("shows exactly the players' darkness while peeking", () => {
    expect(gmDarkness({ scene: scene(0.9), gmView: 0, peeking: true })).toBe(0.9)
  })
})

describe('vision safety', () => {
  const gm = () => useGm.getState()
  // A wall along x = 300; the view is 400 wide, centred on (200, 200) (see tableScreen).
  beforeEach(() => {
    useGm.setState((s) => ({
      scene: {
        ...s.scene,
        walls: [{ id: 'w', points: [{ x: 300, y: -1000 }, { x: 300, y: 1000 }] }],
        lights: [
          { ...createLight('torch', 290, 200, 'eye'), id: 'eye', vision: true, followView: true },
          { ...createLight('fixture', 100, 100, 'lamp'), id: 'lamp' },
        ],
        view: { x: 200, y: 200 },
        fog: { mode: 'full', safety: true },
      },
      tableScreen: { width: 400, height: 400 },
      display: { ...s.display, pxPerMm: 1, orientation: 0 },
      notice: null,
    }))
    useGm.setState((s) => ({ scene: { ...s.scene, squareMm: s.scene.grid.size } })) // 1 table px = 1 unit
  })
  const eye = () => gm().scene.lights.find((l) => l.id === 'eye')!

  it('drops a vision token dragged through a wall, with a notice', () => {
    expect(gm().moveLights(['eye', 'lamp'], 100, 0, true)).toBe(false)
    expect(eye().x).toBe(290)
    expect(gm().notice?.text).toMatch(/VISION SAFETY/)
    expect(gm().moveLights(['eye'], 5, 0, true)).toBe(true) // short of the wall
    expect(gm().moveLights(['lamp'], 500, 0, true)).toBe(true) // not a vision token
  })

  it('lets it through with safety off, or with Alt (not safe)', () => {
    expect(gm().moveLights(['eye'], 100, 0, false)).toBe(true)
    gm().moveLights(['eye'], -100, 0)
    gm().setVisionSafety(false)
    expect(gm().moveLights(['eye'], 100, 0, true)).toBe(true)
  })

  it('holds a travelling vision token at the wall until it would leave the view', () => {
    // The view moves 40 right: the token would cross x = 300, so it stays (inside the view).
    expect(gm().setView({ x: 240, y: 200 }, true)).toBe(true)
    expect(gm().scene.view.x).toBe(240)
    expect(eye().x).toBe(290)
    // Moving diagonally, it slides along the wall.
    expect(gm().setView({ x: 280, y: 230 }, true)).toBe(true)
    expect([eye().x, eye().y]).toEqual([290, 230])
    // Far enough that the token would be left outside the view: refused.
    expect(gm().setView({ x: 500, y: 230 }, true)).toBe(false)
    expect(gm().scene.view.x).toBe(280)
    expect(gm().notice?.text).toMatch(/PVB was dropped/)
  })
})
