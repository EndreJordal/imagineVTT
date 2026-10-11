import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import type { FogMemory } from './fog'
import { extractLevel, type Level } from './levels'
import type { AssetImage, AssetImages } from './mapObjects'
import type { Orientation, Scene } from './types'

/**
 * Scene files (.ivtt): a zip with
 * - scene.json: the floors, the shared scene settings, PVB orientation and GM camera, plus
 *   a format tag and version
 * - maps/<n>.<ext>: each floor's original map image, byte for byte
 * - fog/<n>.bin: each floor's fog memory (what the party has explored), if any
 * - assets/<n>.<ext>: the images of the objects placed (so the file needs no asset library)
 *
 * Version 1 files (one map, map.<ext> and fog.bin) open as a scene with one floor.
 * Calibration (a property of the TV) and GM preferences are not part of a scene.
 */
export const SCENE_FILE_EXTENSION = '.ivtt'
const FORMAT = 'imaginevtt-scene'
const VERSION = 2

/** The GM's view: the scene point at the centre of the view, and the zoom. */
export interface GmCamera {
  x: number
  y: number
  zoom: number
}

export interface SceneFile {
  /** The shared settings, showing the floor that was being viewed (levelId). */
  scene: Scene
  /** All floors, in order. */
  levels: Level[]
  levelId: string
  tableLevelId: string
  /** Per floor: map image and fog memory. */
  mapImages: Record<string, Blob | null>
  fogMemories: Record<string, FogMemory | null>
  orientation: Orientation
  camera: GmCamera | null
  /** Images of the assets the scene's objects show. */
  objectImages: AssetImages
}

interface SceneJson {
  format: typeof FORMAT
  version: number
  scene: Scene
  orientation: Orientation
  camera: GmCamera | null
  /** Version 2. */
  levels?: Level[]
  levelId?: string
  tableLevelId?: string
  maps?: Record<string, { file: string; type: string }>
  fogs?: Record<string, { file: string; cols: number; rows: number }>
  /** Version 1: the one map and fog. */
  map?: { file: string; type: string } | null
  fog?: { cols: number; rows: number } | null
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

const ext = (blob: Blob) => EXTENSIONS[blob.type] ?? 'bin'

export async function writeSceneFile(s: SceneFile): Promise<Blob> {
  // Images are already compressed: store them as-is rather than deflating again.
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}
  const stored = async (blob: Blob) => [new Uint8Array(await blob.arrayBuffer()), { level: 0 }] as [Uint8Array, { level: 0 }]
  const maps: NonNullable<SceneJson['maps']> = {}
  const fogs: NonNullable<SceneJson['fogs']> = {}
  for (const [n, level] of s.levels.entries()) {
    const image = s.mapImages[level.id]
    if (image) {
      const file = `maps/${n}.${ext(image)}`
      files[file] = await stored(image)
      maps[level.id] = { file, type: image.type }
    }
    const fog = s.fogMemories[level.id]
    if (fog) {
      const file = `fog/${n}.bin`
      files[file] = fog.data
      fogs[level.id] = { file, cols: fog.cols, rows: fog.rows }
    }
  }
  // Only the images objects actually show, on any floor.
  const used = new Set(s.levels.flatMap((l) => l.objects ?? []).map((o) => o.asset))
  const assets: NonNullable<SceneJson['assets']> = {}
  let n = 0
  for (const [key, img] of Object.entries(s.objectImages)) {
    if (!used.has(key)) continue
    const file = `assets/${n++}.${ext(img.image)}`
    files[file] = await stored(img.image)
    const { image, ...rest } = img
    assets[key] = { ...rest, file, type: image.type }
  }
  const json: SceneJson = {
    format: FORMAT,
    version: VERSION,
    scene: s.scene,
    orientation: s.orientation,
    camera: s.camera,
    levels: s.levels,
    levelId: s.levelId,
    tableLevelId: s.tableLevelId,
    maps,
    fogs,
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

  // unzipSync returns plain ArrayBuffer-backed arrays, which is what Blob wants.
  const blob = (name: string, type: string) =>
    entries[name] ? new Blob([entries[name] as Uint8Array<ArrayBuffer>], { type }) : null
  const fog = (name: string, cols: number, rows: number): FogMemory | null => {
    const data = entries[name]
    return data && data.length === cols * rows ? { cols, rows, data } : null
  }

  let levels: Level[]
  let levelId: string
  let tableLevelId: string
  const mapImages: Record<string, Blob | null> = {}
  const fogMemories: Record<string, FogMemory | null> = {}
  if (json.levels?.length) {
    levels = json.levels
    levelId = json.levelId ?? levels[0].id
    tableLevelId = json.tableLevelId ?? levelId
    for (const [id, m] of Object.entries(json.maps ?? {})) mapImages[id] = blob(m.file, m.type)
    for (const [id, f] of Object.entries(json.fogs ?? {})) fogMemories[id] = fog(f.file, f.cols, f.rows)
  } else {
    // Version 1: one map, which becomes the one floor.
    const level = extractLevel(json.scene, { id: 'floor-1', name: 'Floor 1' })
    levels = [level]
    levelId = tableLevelId = level.id
    mapImages[level.id] = json.map ? blob(json.map.file, json.map.type) : null
    fogMemories[level.id] = json.fog ? fog('fog.bin', json.fog.cols, json.fog.rows) : null
  }

  const objectImages: AssetImages = {}
  for (const [key, { file: name, type, ...rest }] of Object.entries(json.assets ?? {})) {
    const image = blob(name, type)
    if (image) objectImages[key] = { ...rest, image }
  }
  return {
    scene: json.scene,
    levels,
    levelId,
    tableLevelId,
    mapImages,
    fogMemories,
    orientation: json.orientation ?? 0,
    camera: json.camera ?? null,
    objectImages,
  }
}

/** A scene's name from its file name ("Goblin cave.ivtt" -> "Goblin cave"). */
export function sceneNameFromFile(fileName: string): string {
  return fileName.replace(/\.ivtt$/i, '')
}
