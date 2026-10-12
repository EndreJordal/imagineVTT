import { readNrbf, type NrbfObject, type NrbfValue } from './nrbf'

/**
 * Arkenforge asset files, as found in an asset folder:
 * - <name>.rwmeta: library entry (name, tags, thumbnail, placement preset: scale, animation)
 * - <name>.rwfile: the asset itself; for images, PNGs (one, or one per animation frame); for
 *   sounds, Ogg Vorbis takes
 * - <name>.rwamb: an ambience, layering other sounds (referred to by their Arkenforge paths)
 * Both are .NET BinaryFormatter streams (see nrbf.ts).
 */

/** Arkenforge draws images at this many pixels per grid square, times the asset's scale. */
const ARKENFORGE_PX_PER_SQUARE = 200

export interface AssetMeta {
  name: string
  tags: string[]
  /** PNG bytes of the library thumbnail. */
  thumbnail: Uint8Array | null
  /** Placement scale (see ARKENFORGE_PX_PER_SQUARE). */
  scale: { x: number; y: number }
  /** Animation: frames per second, and frame count (0 for stills). */
  fps: number
  frames: number
  /** Sounds: seconds. */
  duration: number
}

const isObject = (v: NrbfValue | undefined): v is NrbfObject =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)

/** The items of a .NET List<T> (its backing array is longer than its size). */
function listItems(v: NrbfValue | undefined): NrbfValue[] | null {
  if (!isObject(v) || !Array.isArray(v._items)) return null
  return v._items.slice(0, typeof v._size === 'number' ? v._size : v._items.length)
}

/** PNG bytes of an ArkenImage. */
function imageBytes(v: NrbfValue | undefined): Uint8Array | null {
  if (!isObject(v) || !(v._packImageRAW instanceof Uint8Array)) return null
  const b = v._packImageRAW
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 ? b : null
}

export function parseAssetMeta(bytes: Uint8Array): AssetMeta {
  const meta = readNrbf(bytes)
  if (!isObject(meta)) throw new Error('not an asset entry')
  const preset = listItems(meta._variations)?.[0]
  const p = isObject(preset) ? preset : null
  const scale = p && isObject(p._scale) ? p._scale : null
  const anim = p && isObject(p._animation) ? p._animation : null
  const tags = (listItems(meta['ArkenBaseMeta+_tags'] ?? meta._tags) ?? []).filter(
    (t): t is string => typeof t === 'string' && t.length > 0,
  )
  const name = (p && typeof p._name === 'string' && p._name) || (typeof meta._name === 'string' ? meta._name : '')
  return {
    name,
    tags,
    thumbnail: imageBytes(meta._thumbnail),
    scale: { x: num(scale?.x, 1), y: num(scale?.y, 1) },
    fps: num(anim?._framesPerSecond, 30) || 30,
    frames: num(anim?._noOfFrames, 0),
    duration: num(meta._duration, 0),
  }
}

function num(v: NrbfValue | undefined, fallback: number) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * The image frames (PNG bytes) of an asset file: one for a still image, several for an
 * animation. Two layouts exist: the newer ArkenTileUpgrade (content: an image, or a list
 * of them) and the older ArkenTile (image, or a list of tiles, one per frame).
 */
export function parseAssetFrames(bytes: Uint8Array): Uint8Array[] {
  const file = readNrbf(bytes)
  if (!isObject(file)) return []
  const frames = (list: NrbfValue[], pick: (v: NrbfValue) => Uint8Array | null) =>
    list.map(pick).filter((b): b is Uint8Array => !!b)
  if (file.$class === 'ArkenTileUpgrade') {
    const list = listItems(file._content)
    if (list) return frames(list, imageBytes)
    const still = imageBytes(file._content) ?? imageBytes(file._thumbnail)
    return still ? [still] : []
  }
  if (file.$class === 'ArkenTile') {
    const list = listItems(file._content)
    if (list?.length) return frames(list, (t) => (isObject(t) ? (imageBytes(t._image) ?? imageBytes(t._content)) : null))
    const still = imageBytes(file._image) ?? imageBytes(file._content)
    return still ? [still] : []
  }
  return []
}

/** Width and height of a PNG, from its header. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return { width: v.getUint32(16), height: v.getUint32(20) }
}

/** Kinds of visual asset, by the folder they're in. */
export type AssetKind = 'Objects' | 'Textures' | 'Lines' | 'Tokens' | 'Sounds' | 'Ambience'
export const VISUAL_KINDS: AssetKind[] = ['Objects', 'Textures', 'Lines', 'Tokens']
export const AUDIO_KINDS: AssetKind[] = ['Sounds', 'Ambience']
export const ASSET_KINDS: AssetKind[] = [...VISUAL_KINDS, ...AUDIO_KINDS]
export const isAudio = (kind: AssetKind) => AUDIO_KINDS.includes(kind)

/** The Ogg Vorbis takes of a sound's file. */
export function parseSoundTakes(bytes: Uint8Array): Uint8Array[] {
  const file = readNrbf(bytes)
  if (!isObject(file)) return []
  return (listItems(file._tracks) ?? [])
    .map((t) => (isObject(t) && t._clipRAW instanceof Uint8Array ? t._clipRAW : null))
    .filter((b): b is Uint8Array => !!b && b.length > 4 && b[0] === 0x4f && b[1] === 0x67) // "Og"
}

/** An ambience's layers: the sounds (by Arkenforge path), their volume and timing. */
export function parseAmbience(bytes: Uint8Array): { path: string; volume: number; every: number }[] {
  const file = readNrbf(bytes)
  if (!isObject(file)) return []
  return (listItems(file._tracks) ?? []).flatMap((item) => {
    if (!isObject(item) || typeof item._filePath !== 'string' || !isObject(item._content)) return []
    const track = item._content
    const options = isObject(track._options) && Array.isArray(track._options.KeyValuePairs) ? track._options.KeyValuePairs : []
    const volumeEntry = options.find((kv) => isObject(kv) && kv.key === 'Volume')
    const volume = isObject(volumeEntry) ? num(volumeEntry.value, 0.5) : 0.5
    // Timing in seconds (Arkenforge's minutes, unit 1, made seconds); 0: loops.
    const unit = isObject(track._timeUnit) ? num(track._timeUnit.value__, 0) : 0
    const every = num(track._timing, 0) * (unit === 1 ? 60 : 1)
    return [{ path: item._filePath, volume, every }]
  })
}

/** How many squares across a texture is placed at (they're tiling fills in Arkenforge). */
const TEXTURE_SQUARES = 4

/**
 * Default size in grid squares for an image of `width`×`height` px with Arkenforge `scale`.
 * Textures are fills meant to be tiled, with no real size: they get a few squares.
 */
export function defaultSquares(
  kind: AssetKind,
  width: number,
  height: number,
  scale: { x: number; y: number },
): { width: number; height: number } {
  let w = (width * scale.x) / ARKENFORGE_PX_PER_SQUARE
  let h = (height * scale.y) / ARKENFORGE_PX_PER_SQUARE
  if (kind === 'Textures' || !(w > 0 && h > 0) || Math.max(w, h) > 60) {
    const k = TEXTURE_SQUARES / Math.max(width, height)
    w = width * k
    h = height * k
  }
  // Something you can see and grab, but nothing absurd.
  const fit = Math.min(1, 40 / Math.max(w, h)) * Math.max(1, 0.25 / Math.min(w, h))
  return { width: w * fit, height: h * fit }
}
