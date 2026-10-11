import { create } from 'zustand'
import { DEFAULT_CURTAIN, type CurtainState } from '../shared/curtain'
import { load, save } from '../shared/persist'
import { folderPicker, type DirHandle } from './folderAccess'

/**
 * The curtain's pictures and settings. The GM's own, kept across scenes (not part of scene
 * files or undo), so they live apart from the scene store.
 *
 * The pictures are the images in a folder on this computer, read in place: nothing is copied.
 * The folder is listed again whenever the curtain panel opens, so adding a picture is just
 * putting it in the folder.
 */

export interface CurtainPicture {
  /** Path in the folder, e.g. "Intro/Title.jpg": the picture's key (kept in the settings). */
  id: string
  /** File name without extension. */
  name: string
  file: File
}

export type CurtainFolderStatus =
  | 'none' // no folder chosen yet
  | 'unsupported' // the browser can't open folders (Firefox, Safari)
  | 'reconnect' // a folder is remembered, but the browser wants permission again
  | 'scanning'
  | 'ready'

interface CurtainStore {
  state: CurtainState
  folderName: string | null
  status: CurtainFolderStatus
  images: CurtainPicture[]
  setCurtain(patch: Partial<CurtainState>): void
  setSlideshow(patch: Partial<CurtainState['slideshow']>): void
  toggleInSlideshow(id: string): void
}

export const useCurtain = create<CurtainStore>()((set, get) => ({
  state: DEFAULT_CURTAIN,
  folderName: null,
  status: 'none',
  images: [],
  setCurtain: (patch) => set((s) => ({ state: { ...s.state, ...patch } })),
  setSlideshow: (patch) => set((s) => ({ state: { ...s.state, slideshow: { ...s.state.slideshow, ...patch } } })),
  toggleInSlideshow: (id) => {
    const ids = get().state.slideshow.ids
    // Kept in the order of the picker, whatever order they're ticked in.
    const next = ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]
    const order = get().images.map((i) => i.id)
    const sorted = order.filter((i) => next.includes(i))
    get().setSlideshow(sorted.length < 2 ? { ids: sorted, on: false } : { ids: sorted })
  },
}))

const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i

let folder: DirHandle | null = null

/** Ask for the curtain folder, and list its pictures. */
export async function chooseCurtainFolder() {
  const pick = folderPicker()
  if (!pick) return
  let handle: DirHandle
  try {
    handle = await pick({ id: 'imaginevtt-curtain', mode: 'read' })
  } catch {
    return // cancelled
  }
  folder = handle
  await save('curtainFolder', handle).catch(() => {})
  useCurtain.setState({ folderName: handle.name })
  await scanCurtainFolder()
}

/** Permission to read the remembered folder again (needs a click or key press). */
async function reconnect(): Promise<boolean> {
  if (!folder) return false
  const permission = await folder.requestPermission({ mode: 'read' }).catch(() => 'denied' as const)
  if (permission !== 'granted') return false
  await scanCurtainFolder()
  return true
}

export const reconnectCurtainFolder = () => void reconnect()

/** List the folder's pictures (subfolders too), sorted by path. */
export async function scanCurtainFolder() {
  if (!folder) return
  const dir = folder
  useCurtain.setState({ status: 'scanning' })
  try {
    const found: CurtainPicture[] = []
    const walk = async (d: DirHandle, path: string) => {
      for await (const entry of d.values()) {
        if (entry.kind === 'directory') await walk(entry, `${path}${entry.name}/`)
        else if (IMAGE.test(entry.name)) {
          found.push({ id: path + entry.name, name: entry.name.replace(/\.[^.]+$/, ''), file: await entry.getFile() })
        }
      }
    }
    await walk(dir, '')
    if (dir !== folder) return // another folder chosen meanwhile
    found.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    useCurtain.setState((s) => ({
      images: found,
      status: 'ready',
      // The first picture is the one shown, until another is picked.
      state:
        s.state.imageId && found.some((f) => f.id === s.state.imageId)
          ? s.state
          : { ...s.state, imageId: found[0]?.id ?? null },
    }))
  } catch (e) {
    // Moved or deleted, or permission taken back.
    console.warn('Could not read the curtain folder', e)
    useCurtain.setState({ status: 'reconnect' })
  }
}

/**
 * Drop or raise the curtain (button, C key). Dropping it with the folder not yet reconnected
 * asks for permission first: the click or key press counts as the go-ahead.
 */
export async function toggleCurtain() {
  const { state, status } = useCurtain.getState()
  if (!state.down && status === 'reconnect' && !(await reconnect())) return
  if (!state.down && !useCurtain.getState().images.length) return
  useCurtain.getState().setCurtain({ down: !state.down })
}

/** The pictures by id, as the table wants them. */
export function curtainImageMap(images: CurtainPicture[]): Record<string, Blob> {
  return Object.fromEntries(images.map((i) => [i.id, i.file]))
}

/** Restore the curtain from IndexedDB, and save its settings on every change from then on. */
export async function hydrateCurtain(): Promise<() => void> {
  const [state, handle] = await Promise.all([load<CurtainState>('curtain'), load<DirHandle>('curtainFolder')])
  useCurtain.setState({
    state: { ...DEFAULT_CURTAIN, ...state, slideshow: { ...DEFAULT_CURTAIN.slideshow, ...state?.slideshow } },
  })
  if (!folderPicker()) useCurtain.setState({ status: 'unsupported' })
  else if (handle) {
    folder = handle
    useCurtain.setState({ folderName: handle.name })
    const permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt' as const)
    if (permission === 'granted') void scanCurtainFolder()
    else useCurtain.setState({ status: 'reconnect' })
  }
  return useCurtain.subscribe((s, prev) => {
    if (s.state !== prev.state) void save('curtain', s.state)
  })
}
