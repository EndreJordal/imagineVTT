import { existsSync, readdirSync } from 'node:fs'
import sharp from 'sharp'
import { toGray, type GrayImage } from './gridDetect'

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
