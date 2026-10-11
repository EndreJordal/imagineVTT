/// <reference lib="webworker" />
import { detectGrid, toGray, type GridDetection } from '../shared/gridDetect'

/**
 * Decodes the map image and runs grid detection off the main thread. Very large images
 * are decoded at reduced size: a 150-megapixel map would need 600MB of pixels otherwise,
 * and the detector searches at ~2000px anyway.
 */
const MAX_DECODE_SIDE = 8192

export interface DetectRequest {
  image: Blob
  /** The image's natural size, so it needn't be decoded at full size just to measure it. */
  width: number
  height: number
}

/** Detection result in the image's own (natural) pixels, or null if no grid was found. */
export type DetectResponse = { ok: true; detection: GridDetection | null } | { ok: false; error: string }

self.onmessage = async (e: MessageEvent<DetectRequest>) => {
  try {
    const { width, height } = e.data
    const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(width, height))
    const bitmap =
      scale < 1
        ? await createImageBitmap(e.data.image, {
            resizeWidth: Math.round(width * scale),
            resizeHeight: Math.round(height * scale),
            resizeQuality: 'high',
          })
        : await createImageBitmap(e.data.image)

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    const detection = detectGrid(toGray(data, bitmap.width, bitmap.height))
    bitmap.close()

    // Report in natural image pixels.
    const toNatural = (v: number) => v / scale
    const result: DetectResponse = {
      ok: true,
      detection: detection && {
        ...detection,
        period: toNatural(detection.period),
        phaseX: toNatural(detection.phaseX),
        phaseY: toNatural(detection.phaseY),
      },
    }
    self.postMessage(result)
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) } satisfies DetectResponse)
  }
}
