import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import type { FogMemory } from './fog'
import type { AssetImage, AssetImages } from './mapObjects'
import type { Orientation, Scene } from './types'

/**
 * Scene files (.ivtt): a zip with
 * - scene.json: the scene, PVB orientation and GM camera, plus a format tag and version
 * - map.<ext>: the original map image, byte for byte
 * - fog.bin: fog memory (what the party has explored), if any
 * - assets/<n>.<ext>: the images of the objects placed (so the file needs no asset library)
 *
 * Calibration (a property of the TV) and GM preferences are not part of a scene.
 */
export const SCENE_FILE_EXTENSION = '.ivtt'
const FORMAT = 'imaginevtt-scene'
const VERSION = 1

/** The GM's view: the scene point at the centre of the view, and the zoom. */
export interface GmCamera {
  x: number
  y: number
  zoom: number
}

export interface SceneFile {
  scene: Scene
  orientation: Orientation
  camera: GmCamera | null
  mapImage: Blob | null
  fogMemory: FogMemory | null
  /** Images of the assets the scene's objects show. */
  objectImages: AssetImages
}

interface SceneJson {
  format: typeof FORMAT
  version: number
  scene: Scene
  orientation: Orientation
  camera: GmCamera | null
  map: { file: string; type: string } | null
  fog: { cols: number; rows: number } | null
  /** Asset key -> image file in the zip, and its other details. */
  assets?: Record<string, Omit<AssetImage, 'image'> & { file: string; type: string }>
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

export async function writeSceneFile(s: SceneFile): Promise<Blob> {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}
  let map: SceneJson['map'] = null
  if (s.mapImage) {
    const file = `map.${EXTENSIONS[s.mapImage.type] ?? 'bin'}`
    // Images are already compressed: store them as-is rather than deflating again.
    files[file] = [new Uint8Array(await s.mapImage.arrayBuffer()), { level: 0 }]
    map = { file, type: s.mapImage.type }
  }
  if (s.fogMemory) files['fog.bin'] = s.fogMemory.data
  // Only the images objects actually show.
  const used = new Set((s.scene.objects ?? []).map((o) => o.asset))
  const assets: NonNullable<SceneJson['assets']> = {}
  let n = 0
  for (const [key, img] of Object.entries(s.objectImages)) {
    if (!used.has(key)) continue
    const file = `assets/${n++}.${EXTENSIONS[img.image.type] ?? 'bin'}`
    files[file] = [new Uint8Array(await img.image.arrayBuffer()), { level: 0 }]
    const { image, ...rest } = img
    assets[key] = { ...rest, file, type: image.type }
  }
  const json: SceneJson = {
    format: FORMAT,
    version: VERSION,
    scene: s.scene,
    orientation: s.orientation,
    camera: s.camera,
    map,
    fog: s.fogMemory && { cols: s.fogMemory.cols, rows: s.fogMemory.rows },
    assets,
  }
  files['scene.json'] = strToU8(JSON.stringify(json, null, 2))
  return new Blob([zipSync(files)], { type: 'application/zip' })
}

export class SceneFileError extends Error {}

/** Read a scene file. The scene comes back as saved; the caller fills in newer fields. */
export async function readSceneFile(file: Blob): Promise<SceneFile> {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new SceneFileError('This is not an imagineVTT scene file.')
  }
  const raw = entries['scene.json']
  let json: SceneJson
  try {
    json = JSON.parse(strFromU8(raw))
  } catch {
    throw new SceneFileError('This is not an imagineVTT scene file.')
  }
  if (!raw || json.format !== FORMAT) throw new SceneFileError('This is not an imagineVTT scene file.')
  if (json.version > VERSION) {
    throw new SceneFileError('This scene was saved by a newer version of imagineVTT.')
  }

  const mapBytes = json.map && entries[json.map.file]
  const fogBytes = entries['fog.bin']
  const objectImages: AssetImages = {}
  for (const [key, { file: name, type, ...rest }] of Object.entries(json.assets ?? {})) {
    const bytes = entries[name]
    if (bytes) objectImages[key] = { ...rest, image: new Blob([bytes as Uint8Array<ArrayBuffer>], { type }) }
  }
  return {
    scene: json.scene,
    orientation: json.orientation ?? 0,
    camera: json.camera ?? null,
    // unzipSync returns plain ArrayBuffer-backed arrays, which is what Blob wants.
    mapImage: json.map && mapBytes ? new Blob([mapBytes as Uint8Array<ArrayBuffer>], { type: json.map.type }) : null,
    fogMemory:
      json.fog && fogBytes && fogBytes.length === json.fog.cols * json.fog.rows
        ? { cols: json.fog.cols, rows: json.fog.rows, data: fogBytes }
        : null,
    objectImages,
  }
}

/** A scene's name from its file name ("Goblin cave.ivtt" -> "Goblin cave"). */
export function sceneNameFromFile(fileName: string): string {
  return fileName.replace(/\.ivtt$/i, '')
}
