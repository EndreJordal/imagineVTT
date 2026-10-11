import type { MapImage, RgbImage } from '../shared/wallDetect'

/** A decoded image turned `turns` quarter turns clockwise (the same bitmap if none). */
export async function turnBitmap(bitmap: ImageBitmap, turns: number): Promise<ImageBitmap> {
  const q = ((turns % 4) + 4) % 4
  if (!q) return bitmap
  const [w, h] = q % 2 ? [bitmap.height, bitmap.width] : [bitmap.width, bitmap.height]
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.translate(w / 2, h / 2)
  ctx.rotate((q * Math.PI) / 2)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  bitmap.close()
  return canvas.transferToImageBitmap()
}

/** A decoded map image the detectors can ask for at reduced size (drawn scaled on a canvas). */
export function bitmapMapImage(bitmap: ImageBitmap, width = bitmap.width, height = bitmap.height): MapImage {
  return {
    width,
    height,
    scaled(scale: number): RgbImage {
      const w = Math.max(1, Math.round(width * Math.min(1, scale)))
      const h = Math.max(1, Math.round(height * Math.min(1, scale)))
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, w, h)
      const rgba = ctx.getImageData(0, 0, w, h).data
      const data = new Float32Array(w * h * 3)
      for (let i = 0, j = 0; i < w * h; i++, j += 4) {
        data[i * 3] = rgba[j] / 255
        data[i * 3 + 1] = rgba[j + 1] / 255
        data[i * 3 + 2] = rgba[j + 2] / 255
      }
      return { width: w, height: h, data }
    },
  }
}
