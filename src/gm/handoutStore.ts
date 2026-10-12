import { create } from 'zustand'
import { turnBy, type Turn } from '../shared/handout'
import { load, save } from '../shared/persist'
import type { Size } from '../shared/types'
import { folderPicker, listPictures, samePictures, type DirHandle, type Picture } from './folderAccess'

/**
 * Pictures to show the players (handouts): the images in a folder on this computer, read in
 * place. The GM's own, kept across scenes; what's showing is this session's only.
 */

export type HandoutFolderStatus = 'none' | 'unsupported' | 'reconnect' | 'scanning' | 'ready'

/** What the table shows: a picture (its size, for the GM's outline of it), turned. */
export interface ShownHandout {
  id: string
  size: Size
}

interface HandoutStore {
  folderName: string | null
  status: HandoutFolderStatus
  images: Picture[]
  /** The picture picked in the list. */
  selectedId: string | null
  /** The picture on the table, if any. */
  shown: ShownHandout | null
  /** How each picture is turned (remembered). */
  turns: Record<string, Turn>
  /** Fill the screen (to the margin, cropping) rather than show the picture at its own size. */
  fill: boolean
  setFill(fill: boolean): void
  select(id: string | null): void
  /** Turn a picture by quarter turns (clockwise). */
  turn(id: string, by: number): void
}

export const useHandouts = create<HandoutStore>()((set) => ({
  folderName: null,
  status: 'none',
  images: [],
  selectedId: null,
  shown: null,
  turns: {},
  fill: false,
  setFill: (fill) => set({ fill }),
  select: (selectedId) => set({ selectedId }),
  turn: (id, by) => set((s) => ({ turns: { ...s.turns, [id]: turnBy(s.turns[id] ?? 0, by) } })),
}))

let folder: DirHandle | null = null

export async function chooseHandoutFolder() {
  const pick = folderPicker()
  if (!pick) return
  let handle: DirHandle
  try {
    handle = await pick({ id: 'imaginevtt-handouts', mode: 'read' })
  } catch {
    return // cancelled
  }
  folder = handle
  await save('handoutFolder', handle).catch(() => {})
  useHandouts.setState({ folderName: handle.name, selectedId: null })
  await scanHandoutFolder()
}

export async function reconnectHandoutFolder() {
  if (!folder) return
  const permission = await folder.requestPermission({ mode: 'read' }).catch(() => 'denied' as const)
  if (permission === 'granted') await scanHandoutFolder()
}

export async function scanHandoutFolder() {
  if (!folder) return
  const dir = folder
  useHandouts.setState({ status: 'scanning' })
  try {
    const found = await listPictures(dir)
    if (dir !== folder) return
    useHandouts.setState((s) => ({
      images: samePictures(s.images, found) ? s.images : found,
      status: 'ready',
      selectedId: s.selectedId && found.some((f) => f.id === s.selectedId) ? s.selectedId : (found[0]?.id ?? null),
    }))
  } catch (e) {
    console.warn('Could not read the handout folder', e)
    useHandouts.setState({ status: 'reconnect' })
  }
}

/** Show a picture to the players (another one showing is swapped for it). */
export async function showHandout(id: string) {
  const image = useHandouts.getState().images.find((i) => i.id === id)
  if (!image) return
  try {
    const bitmap = await createImageBitmap(image.file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    useHandouts.setState({ shown: { id, size } })
  } catch {
    // not a picture the browser can read
  }
}

export const hideHandout = () => useHandouts.setState({ shown: null })

/** What the table needs: the shown picture's file and turn. */
export function tableHandout(s: HandoutStore): { id: string; image: Blob; turn: Turn; fill: boolean } | null {
  const image = s.shown && s.images.find((i) => i.id === s.shown!.id)
  return image ? { id: image.id, image: image.file, turn: s.turns[image.id] ?? 0, fill: s.fill } : null
}

/** Restore the folder and turns, and save the turns on every change from then on. */
export async function hydrateHandouts(): Promise<() => void> {
  const [turns, handle, fill] = await Promise.all([
    load<Record<string, Turn>>('handoutTurns'),
    load<DirHandle>('handoutFolder'),
    load<boolean>('handoutFill'),
  ])
  useHandouts.setState({ turns: turns ?? {}, fill: !!fill })
  if (!folderPicker()) useHandouts.setState({ status: 'unsupported' })
  else if (handle) {
    folder = handle
    useHandouts.setState({ folderName: handle.name })
    const permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt' as const)
    if (permission === 'granted') void scanHandoutFolder()
    else useHandouts.setState({ status: 'reconnect' })
  }
  return useHandouts.subscribe((s, prev) => {
    if (s.turns !== prev.turns) void save('handoutTurns', s.turns)
    if (s.fill !== prev.fill) void save('handoutFill', s.fill)
  })
}
