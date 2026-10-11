/// <reference lib="webworker" />
import { detectWalls, type DetectedWall, type GridSpec } from '../shared/wallDetect'
import { bitmapMapImage } from './bitmapImage'

/** Finds walls and doors on the map image off the main thread. */
export interface WallDetectRequest {
  image: Blob
  /** The image's natural size. */
  width: number
  height: number
  /** The scene grid, in the image's natural pixels. */
  grid: GridSpec
}

/** Walls in the image's natural pixels. */
export type WallDetectResponse = { ok: true; walls: DetectedWall[] } | { ok: false; error: string }

self.onmessage = async (e: MessageEvent<WallDetectRequest>) => {
  try {
    const { image, width, height, grid } = e.data
    // The detector works at about 16 px per square: decode no bigger than it needs.
    const scale = Math.min(1, 16 / grid.period)
    const bitmap = await createImageBitmap(image, {
      resizeWidth: Math.max(1, Math.round(width * scale)),
      resizeHeight: Math.max(1, Math.round(height * scale)),
      resizeQuality: 'high',
    })
    const walls = detectWalls(bitmapMapImage(bitmap, width, height), grid)
    bitmap.close()
    self.postMessage({ ok: true, walls } satisfies WallDetectResponse)
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) } satisfies WallDetectResponse)
  }
}
