import { create } from 'zustand'
import { DEFAULT_CURTAIN, type CurtainState } from '../shared/curtain'
import { load, save } from '../shared/persist'
import type { Picture as CurtainPicture } from './folderAccess'
import { pictureFolder, type FolderStatus } from './pictureFolder'

/**
 * The curtain's pictures and settings. The GM's own, kept across scenes (not part of scene
 * files or undo), so they live apart from the scene store.
 *
 * The pictures are the images in a folder on this computer, read in place: nothing is copied.
 * The folder is listed again whenever the curtain panel opens, so adding a picture is just
 * putting it in the folder.
 */

export type { Picture as CurtainPicture } from './folderAccess'


interface CurtainStore {
  state: CurtainState
  folderName: string | null
  status: FolderStatus
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

const folder = pictureFolder(useCurtain, 'curtain', (s, found) => ({
  // The first picture is the one shown, until another is picked.
  state: s.state.imageId && found.some((f) => f.id === s.state.imageId) ? s.state : { ...s.state, imageId: found[0]?.id ?? null },
}))

/** Ask for the curtain folder, and list its pictures. */
export const chooseCurtainFolder = () => folder.choose()
export const reconnectCurtainFolder = () => void folder.reconnect()
/** List the folder's pictures (subfolders too), sorted by path. */
export const scanCurtainFolder = () => folder.scan()

/**
 * Drop or raise the curtain (button, C key). Dropping it with the folder not yet reconnected
 * asks for permission first: the click or key press counts as the go-ahead.
 */
export async function toggleCurtain() {
  const { state, status } = useCurtain.getState()
  if (!state.down && status === 'reconnect' && !(await folder.reconnect())) return
  if (!state.down && !useCurtain.getState().images.length) return
  useCurtain.getState().setCurtain({ down: !state.down })
}

/** The pictures by id, as the table wants them. */
export function curtainImageMap(images: CurtainPicture[]): Record<string, Blob> {
  return Object.fromEntries(images.map((i) => [i.id, i.file]))
}

/** Restore the curtain from IndexedDB, and save its settings on every change from then on. */
export async function hydrateCurtain(): Promise<() => void> {
  const state = await load<CurtainState>('curtain')
  useCurtain.setState({
    state: { ...DEFAULT_CURTAIN, ...state, slideshow: { ...DEFAULT_CURTAIN.slideshow, ...state?.slideshow } },
  })
  await folder.restore()
  return useCurtain.subscribe((s, prev) => {
    if (s.state !== prev.state) void save('curtain', s.state)
  })
}
