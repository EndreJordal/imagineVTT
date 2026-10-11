import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readSceneFile, SceneFileError, writeSceneFile, type SceneFile } from './sceneFile'
import type { Scene } from './types'

const scene: Scene = {
  map: { x: 10, y: 20, width: 2000, height: 1000, naturalWidth: 4000, naturalHeight: 2000, lockToGrid: true },
  grid: { size: 100, offsetX: 5, offsetY: 0, visible: true, color: '#ff0000', opacity: 0.5 },
  squareMm: 25.4,
  view: { x: 700, y: 400 },
  darkness: 0.8,
  lights: [],
  fog: { enabled: true },
  walls: [{ id: 'w', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }],
}

const sample = (): SceneFile => ({
  scene,
  orientation: 90,
  camera: { x: 500, y: 300, zoom: 0.4 },
  mapImage: new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])], { type: 'image/jpeg' }),
  fogMemory: { cols: 4, rows: 2, data: new Uint8Array([0, 255, 128, 0, 0, 0, 255, 255]) },
})

describe('scene files', () => {
  it('round-trips everything a scene holds', async () => {
    const back = await readSceneFile(await writeSceneFile(sample()))
    expect(back.scene).toEqual(scene)
    expect(back.orientation).toBe(90)
    expect(back.camera).toEqual({ x: 500, y: 300, zoom: 0.4 })
    expect(back.mapImage?.type).toBe('image/jpeg')
    expect([...new Uint8Array(await back.mapImage!.arrayBuffer())]).toEqual([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])
    expect(back.fogMemory).toEqual(sample().fogMemory)
  })

  it('saves a scene without a map or fog', async () => {
    const back = await readSceneFile(await writeSceneFile({ ...sample(), mapImage: null, fogMemory: null }))
    expect([back.mapImage, back.fogMemory]).toEqual([null, null])
  })

  it('rejects files that are not scenes, or from a newer version', async () => {
    await expect(readSceneFile(new Blob(['hello']))).rejects.toBeInstanceOf(SceneFileError)
    const otherZip = new Blob([zipSync({ 'a.txt': strToU8('x') })])
    await expect(readSceneFile(otherZip)).rejects.toBeInstanceOf(SceneFileError)
    const future = new Blob([zipSync({ 'scene.json': strToU8(JSON.stringify({ format: 'imaginevtt-scene', version: 99 })) })])
    await expect(readSceneFile(future)).rejects.toThrow(/newer version/)
  })
})
