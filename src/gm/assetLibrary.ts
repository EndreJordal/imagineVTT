import { create } from 'zustand'
import {
  ASSET_KINDS,
  defaultSquares,
  isAudio,
  parseAmbience,
  parseAssetMeta,
  parseSoundTakes,
  type AssetKind,
} from '../shared/arkenAsset'
import type { SoundClip, SoundClips } from '../shared/sound'
import type { AssetImage } from '../shared/mapObjects'
import { load, save } from '../shared/persist'
import type { Point } from '../shared/types'
import type { AssetImageRequest, AssetImageResponse } from './assetImage.worker'
import { folderPicker as picker, type DirHandle, type FileHandle } from './folderAccess'
import { useGm } from './store'

/**
 * The asset library: a folder of Arkenforge assets on this computer, read in place (Chrome
 * and Edge can be given access to a folder, and remember it). Its visual assets are indexed
 * once, with their thumbnails, and the index kept, so browsing is instant afterwards; it's
 * brought up to date on a rescan. Images are read from the folder when an asset is placed.
 *
 * Expected layout: <genre>/<kind>/<category>/.../<name>.rwmeta + <name>.rwfile, with kind
 * one of Objects, Textures, Lines, Tokens.
 */

export interface LibraryAsset {
  /** Path in the folder without extension, e.g. "Fantasy/Objects/Trees/Tree 1": the asset's key. */
  path: string
  name: string
  genre: string
  kind: AssetKind
  /** Folders under the kind, e.g. "Trees › Animated". */
  category: string
  tags: string[]
  thumb: Blob | null
  scale: { x: number; y: number }
  fps: number
  animated: boolean
  /** Sounds: seconds. */
  duration?: number
  /** The .rwmeta file's date and size, to tell when it changed. */
  modified: number
  size: number
}

type Status =
  | { kind: 'unsupported' }
  | { kind: 'none' }
  | { kind: 'reconnect' }
  | { kind: 'scanning'; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

interface LibraryState {
  status: Status
  folderName: string | null
  assets: LibraryAsset[]
  /** The asset shown in the preview panel. */
  previewing: string | null
  setPreviewing(path: string | null): void
}

export const useAssets = create<LibraryState>()((set) => ({
  status: { kind: 'none' },
  folderName: null,
  assets: [],
  previewing: null,
  setPreviewing: (previewing) => set({ previewing }),
}))

let folder: DirHandle | null = null

/** At startup: the remembered folder and index, if any. */
export async function initAssetLibrary() {
  if (!picker()) {
    useAssets.setState({ status: { kind: 'unsupported' } })
    return
  }
  const [handle, index] = await Promise.all([load<DirHandle>('assetFolder'), load<LibraryAsset[]>('assetIndex')])
  if (!handle) return
  folder = handle
  useAssets.setState({ folderName: handle.name, assets: index ?? [] })
  const permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt' as const)
  useAssets.setState({ status: { kind: permission === 'granted' ? 'ready' : 'reconnect' } })
  if (permission === 'granted' && !index?.length) void scanFolder()
}

/** Ask for an asset folder, and index it. */
export async function chooseAssetFolder() {
  const pick = picker()
  if (!pick) return
  let handle: DirHandle
  try {
    handle = await pick({ id: 'imaginevtt-assets', mode: 'read' })
  } catch {
    return // cancelled
  }
  folder = handle
  // Remembered for later visits where the browser can store it; works for this one anyway.
  await save('assetFolder', handle).catch(() => {})
  useAssets.setState({ folderName: handle.name })
  await scanFolder()
}

/** Access to the remembered folder again (browsers ask once per visit). */
export async function reconnectAssetFolder() {
  if (!folder) return chooseAssetFolder()
  const permission = await folder.requestPermission({ mode: 'read' }).catch(() => 'denied' as const)
  if (permission === 'granted') useAssets.setState({ status: { kind: 'ready' } })
}

/** Index the folder's visual assets, reusing what's unchanged from the last index. */
export async function scanFolder() {
  if (!folder) return
  const previous = new Map(useAssets.getState().assets.map((a) => [a.path, a]))
  useAssets.setState({ status: { kind: 'scanning', done: 0, total: 0 } })
  try {
    // Find the entries first, for progress.
    const found: { path: string; genre: string; kind: AssetKind; category: string; handle: FileHandle }[] = []
    for await (const genre of folder.values()) {
      if (genre.kind !== 'directory' || genre.name.startsWith('_')) continue
      for await (const kindDir of genre.values()) {
        if (kindDir.kind !== 'directory' || !ASSET_KINDS.includes(kindDir.name as AssetKind)) continue
        await walk(kindDir, [], (dirs, handle) => {
          const name = handle.name.replace(/\.rwmeta$/i, '')
          found.push({
            path: [genre.name, kindDir.name, ...dirs, name].join('/'),
            genre: genre.name,
            kind: kindDir.name as AssetKind,
            category: dirs.join(' › ') || 'General',
            handle,
          })
        })
      }
    }
    const assets: LibraryAsset[] = []
    for (let i = 0; i < found.length; i++) {
      const f = found[i]
      const file = await f.handle.getFile()
      const old = previous.get(f.path)
      if (old && old.modified === file.lastModified && old.size === file.size) {
        assets.push(old)
      } else {
        try {
          const meta = parseAssetMeta(new Uint8Array(await file.arrayBuffer()))
          assets.push({
            path: f.path,
            name: meta.name || f.path.split('/').at(-1)!,
            genre: f.genre,
            kind: f.kind,
            category: f.category,
            tags: meta.tags,
            thumb: meta.thumbnail ? new Blob([meta.thumbnail as Uint8Array<ArrayBuffer>], { type: 'image/png' }) : null,
            scale: meta.scale,
            fps: meta.fps,
            // Some animations don't say so in their entry; their folder does.
            animated: meta.frames > 0 || /animated/i.test(f.path),
            ...(isAudio(f.kind) && { duration: meta.duration }),
            modified: file.lastModified,
            size: file.size,
          })
        } catch {
          // Not an asset entry we can read: leave it out.
        }
      }
      if (i % 25 === 0) {
        useAssets.setState({ status: { kind: 'scanning', done: i, total: found.length } })
        await new Promise((r) => setTimeout(r)) // let the page breathe
      }
    }
    assets.sort((a, b) => a.name.localeCompare(b.name))
    useAssets.setState({ assets, status: { kind: 'ready' } })
    await save('assetIndex', assets)
  } catch (err) {
    useAssets.setState({ status: { kind: 'error', message: String(err) } })
  }
}

async function walk(dir: DirHandle, dirs: string[], onMeta: (dirs: string[], file: FileHandle) => void) {
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') await walk(entry, [...dirs, entry.name], onMeta)
    else if (entry.name.toLowerCase().endsWith('.rwmeta')) onMeta(dirs, entry)
  }
}

/** An asset's file in the folder. */
async function assetFile(path: string, ext = 'rwfile'): Promise<File> {
  if (!folder) throw new Error('No asset folder')
  const parts = path.split('/')
  let dir = folder
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part)
  return (await dir.getFileHandle(`${parts.at(-1)}.${ext}`)).getFile()
}

/** Arkenforge paths of moved sounds -> their paths in the folder (_index/moved.json), if any. */
let moved: Promise<Record<string, string>> | null = null
function movedPaths(): Promise<Record<string, string>> {
  moved ??= (async () => {
    try {
      const index = await folder!.getDirectoryHandle('_index')
      const file = await (await index.getFileHandle('moved.json')).getFile()
      return JSON.parse(await file.text()) as Record<string, string>
    } catch {
      return {}
    }
  })()
  return moved
}

/** The library sound an ambience's layer means (by Arkenforge path, else by name). */
async function layerSound(arkenPath: string): Promise<LibraryAsset | undefined> {
  const assets = useAssets.getState().assets
  const to = (await movedPaths())[arkenPath]
  const path = to?.replace(/\.rwmeta$/i, '')
  const name = arkenPath.split('/').at(-1)!.replace(/\.rwmeta$/i, '')
  return (
    (path && assets.find((a) => a.path === path)) ||
    assets.find((a) => a.kind === 'Sounds' && a.name.toLowerCase() === name.toLowerCase())
  )
}

const clips = new Map<string, Promise<SoundClips>>()

/** A sound's audio (an ambience's with its layers'), read from the folder; by clip key. */
export function soundClips(asset: LibraryAsset): Promise<SoundClips> {
  let p = clips.get(asset.path)
  if (!p) {
    p = (async (): Promise<SoundClips> => {
      if (asset.kind === 'Ambience') {
        const layers = parseAmbience(new Uint8Array(await (await assetFile(asset.path, 'rwamb')).arrayBuffer()))
        const out: SoundClips = {}
        const ambience: SoundClip = { name: asset.name, duration: 0, takes: [], layers: [] }
        for (const l of layers) {
          const sound = await layerSound(l.path)
          if (!sound) continue // Arkenforge's own presets miss a few sounds
          Object.assign(out, await soundClips(sound))
          ambience.layers!.push({ clip: sound.path, volume: l.volume, every: l.every })
        }
        out[asset.path] = ambience
        return out
      }
      const takes = parseSoundTakes(new Uint8Array(await (await assetFile(asset.path)).arrayBuffer()))
      if (!takes.length) throw new Error('no audio in it')
      const blobs = takes.map((t) => new Blob([t as Uint8Array<ArrayBuffer>], { type: 'audio/ogg' }))
      return { [asset.path]: { name: asset.name, duration: asset.duration ?? 0, takes: blobs } }
    })()
    clips.set(asset.path, p)
    p.catch(() => clips.delete(asset.path))
  }
  return p
}

/** Load a library sound into the scene (for doors, the mixer); false if it can't be read. */
export async function loadSound(path: string): Promise<boolean> {
  const gm = useGm.getState()
  if (gm.soundClips[path]) return true
  const asset = useAssets.getState().assets.find((a) => a.path === path)
  if (!asset) return false
  try {
    gm.addSoundClips(await soundClips(asset))
    return true
  } catch (err) {
    gm.notify(`Couldn’t load “${asset.name}”: ${(err as Error).message}`)
    return false
  }
}

/** Drop a library sound on the map. */
export async function placeSound(path: string, at: Point) {
  const asset = useAssets.getState().assets.find((a) => a.path === path)
  if (!asset) return
  if (useAssets.getState().status.kind !== 'ready' && !useGm.getState().soundClips[path]) {
    useGm.getState().notify('Reconnect the asset folder (Assets, in the sidebar) to place new sounds.')
    return
  }
  if (await loadSound(path)) useGm.getState().addSound(path, asset.name, at)
}

/**
 * Images made this visit, by asset (previewing then placing an asset reuses it): the last
 * few only, as animated ones are big. Placed ones live on in the scene's objectImages.
 */
const images = new Map<string, Promise<AssetImage>>()
const KEEP_IMAGES = 12

/** An asset's image, ready to show: from the scene if it's placed already, else made from its file. */
export function assetImage(asset: LibraryAsset): Promise<AssetImage> {
  const placed = useGm.getState().objectImages[asset.path]
  if (placed) return Promise.resolve(placed)
  let p = images.get(asset.path)
  if (p) images.delete(asset.path) // most recently used last
  else {
    p = makeImage(asset)
    p.catch(() => images.delete(asset.path))
  }
  images.set(asset.path, p)
  while (images.size > KEEP_IMAGES) images.delete(images.keys().next().value!)
  return p
}

async function makeImage(asset: LibraryAsset): Promise<AssetImage> {
  const file = await assetFile(asset.path)
  const worker = new Worker(new URL('./assetImage.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<AssetImage>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<AssetImageResponse>) =>
        e.data.ok ? resolve(e.data.image) : reject(new Error(e.data.error))
      worker.onerror = (e) => reject(new Error(e.message))
      worker.postMessage({ file, fps: asset.fps } satisfies AssetImageRequest)
    })
  } finally {
    worker.terminate()
  }
}

/** Place an asset on the map, centred at `at` (scene coordinates), at its natural size. */
export async function placeAsset(path: string, at: Point) {
  const asset = useAssets.getState().assets.find((a) => a.path === path)
  if (!asset) return
  if (isAudio(asset.kind)) return placeSound(path, at)
  const gm = useGm.getState()
  if (useAssets.getState().status.kind !== 'ready' && !gm.objectImages[path]) {
    gm.notify('Reconnect the asset folder (Assets, in the sidebar) to place new assets.')
    return
  }
  let image: AssetImage
  try {
    image = await assetImage(asset)
  } catch (err) {
    gm.notify(`Couldn’t load “${asset.name}”: ${(err as Error).message}`)
    return
  }
  const squares = defaultSquares(asset.kind, image.width, image.height, asset.scale)
  const size = useGm.getState().scene.grid.size
  useGm.getState().setObjectImage(path, image)
  useGm.getState().addObject({
    asset: path,
    name: asset.name,
    x: at.x,
    y: at.y,
    width: squares.width * size,
    height: squares.height * size,
    rotation: 0,
  })
}

/** Drag-and-drop type carrying an asset's path from the browser to the map. */
export const ASSET_DRAG_TYPE = 'application/x-imaginevtt-asset'
