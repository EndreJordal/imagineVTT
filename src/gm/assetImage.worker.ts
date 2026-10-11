/// <reference lib="webworker" />
import { parseAssetFrames, pngSize } from '../shared/arkenAsset'
import type { AssetImage } from '../shared/mapObjects'

/**
 * Turns an asset file (.rwfile) into an image ready to place: a still image as it is (or
 * scaled down if huge), or an animation as one sprite sheet of all its frames, small enough
 * for an integrated GPU (Arkenforge keeps every frame as a full-size PNG).
 */
export interface AssetImageRequest {
  file: Blob
  fps: number
}

export type AssetImageResponse = { ok: true; image: AssetImage } | { ok: false; error: string }

/** Largest side of a still image (bigger ones are scaled down). */
const MAX_STILL = 2048
/** Largest sprite sheet side, and largest frame side within it. */
const MAX_SHEET = 2048
const MAX_FRAME = 256
/** Transparent border around each frame, so neighbours don't bleed in when scaled down. */
const PAD = 2

self.onmessage = async (e: MessageEvent<AssetImageRequest>) => {
  try {
    const frames = parseAssetFrames(new Uint8Array(await e.data.file.arrayBuffer()))
    if (!frames.length) throw new Error('no image in this asset')
    const image = frames.length === 1 ? await still(frames[0]) : await sheet(frames, e.data.fps)
    self.postMessage({ ok: true, image } satisfies AssetImageResponse)
  } catch (err) {
    self.postMessage({ ok: false, error: String(err) } satisfies AssetImageResponse)
  }
}

const png = (bytes: Uint8Array) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })

async function still(bytes: Uint8Array): Promise<AssetImage> {
  const { width, height } = pngSize(bytes)
  if (Math.max(width, height) <= MAX_STILL) return { image: png(bytes), width, height }
  const k = MAX_STILL / Math.max(width, height)
  const bitmap = await createImageBitmap(png(bytes), {
    resizeWidth: Math.round(width * k),
    resizeHeight: Math.round(height * k),
    resizeQuality: 'high',
  })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { image: await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 }), width, height }
}

async function sheet(frames: Uint8Array[], fps: number): Promise<AssetImage> {
  const { width, height } = pngSize(frames[0])
  const count = frames.length
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  // Frames as big as fit: within MAX_FRAME, and the sheet within MAX_SHEET.
  const fit = Math.min(MAX_FRAME / Math.max(width, height), (MAX_SHEET / cols - 2 * PAD) / width, (MAX_SHEET / rows - 2 * PAD) / height, 1)
  const fw = Math.max(1, Math.floor(width * fit))
  const fh = Math.max(1, Math.floor(height * fit))
  const canvas = new OffscreenCanvas(cols * (fw + 2 * PAD), rows * (fh + 2 * PAD))
  const ctx = canvas.getContext('2d')!
  for (let i = 0; i < count; i++) {
    const bitmap = await createImageBitmap(png(frames[i]), { resizeWidth: fw, resizeHeight: fh, resizeQuality: 'high' })
    ctx.drawImage(bitmap, (i % cols) * (fw + 2 * PAD) + PAD, Math.floor(i / cols) * (fh + 2 * PAD) + PAD)
    bitmap.close()
  }
  const image = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })
  return { image, width, height, frames: { count, cols, rows, fps, frameWidth: fw, frameHeight: fh, pad: PAD } }
}
