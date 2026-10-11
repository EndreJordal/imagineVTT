import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redo, startHistory, undo } from './history'
import { useGm } from './store'

describe('undo/redo', () => {
  let stop: () => void
  const gm = () => useGm.getState()
  const lightCount = () => gm().scene.lights.length
  const quiet = () => vi.advanceTimersByTime(1000)

  beforeEach(() => {
    vi.useFakeTimers()
    // history.ts listens for pointers on window; tests run without a DOM.
    vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }))
    useGm.setState((s) => ({ scene: { ...s.scene, lights: [], walls: [] } }))
    stop = startHistory()
  })
  afterEach(() => {
    stop()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('undoes and redoes edits one step at a time', () => {
    gm().addLight('torch', { x: 0, y: 0 })
    quiet()
    gm().addLight('candle', { x: 10, y: 0 })
    quiet()
    expect(gm().history).toEqual({ canUndo: true, canRedo: false })
    undo()
    expect(lightCount()).toBe(1)
    undo()
    expect(lightCount()).toBe(0)
    expect(gm().history).toEqual({ canUndo: false, canRedo: true })
    redo()
    redo()
    expect(lightCount()).toBe(2)
  })

  it('makes a burst of changes (a drag) one step, also while the pointer is held still', () => {
    gm().addLight('torch', { x: 0, y: 0 })
    quiet()
    const id = gm().scene.lights[0].id
    window.dispatchEvent(new Event('pointerdown'))
    gm().moveLights([id], 5, 0)
    vi.advanceTimersByTime(2000) // held still mid-drag
    gm().moveLights([id], 5, 0)
    window.dispatchEvent(new Event('pointerup'))
    quiet()
    undo()
    expect(gm().scene.lights[0].x).toBe(0)
  })

  it('drops the redo steps on a new edit, and all history on a new scene', () => {
    gm().addLight('torch', { x: 0, y: 0 })
    quiet()
    undo()
    gm().addLight('candle', { x: 0, y: 0 })
    expect(gm().history.canRedo).toBe(false)
    gm().newScene()
    expect(gm().history).toEqual({ canUndo: false, canRedo: false })
  })
})
