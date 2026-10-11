import type { MapImage, RgbImage } from '../shared/wallDetect'

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
