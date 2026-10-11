import { existsSync, readdirSync } from 'node:fs'
import sharp from 'sharp'
import { toGray, type GrayImage } from './gridDetect'
import { toRgb, type RgbImage } from './wallDetect'

/** Real battlemaps for tuning and regression tests. Not committed; tests skip without them. */
export const MAP_DIR = 'test-maps'

export const mapFiles = (): string[] =>
  existsSync(MAP_DIR) ? readdirSync(MAP_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)) : []

export async function loadMap(file: string): Promise<GrayImage> {
  const { data, info } = await sharp(`${MAP_DIR}/${file}`, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return toGray(data, info.width, info.height)
}

/** Maps with walls, for the wall detector: test-maps/walled maps/. */
export const WALLED_DIR = `${MAP_DIR}/walled maps`

export const walledMapFiles = (): string[] =>
  existsSync(WALLED_DIR) ? readdirSync(WALLED_DIR).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)) : []

/** A map's pixels as RGB (0..1), and as grey for the grid detector. */
export async function loadRgb(path: string): Promise<{ rgb: RgbImage; gray: GrayImage }> {
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { rgb: toRgb(data, info.width, info.height), gray: toGray(data, info.width, info.height) }
}
