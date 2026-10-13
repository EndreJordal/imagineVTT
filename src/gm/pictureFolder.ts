import { load, save } from '../shared/persist'
import { folderPicker, listPictures, samePictures, type DirHandle, type Picture } from './folderAccess'

/**
 * A folder of pictures on this computer (maps, pictures to show the players), read in place:
 * nothing is copied. The folder is remembered; the browser asks again on later visits.
 */

export type FolderStatus =
  | 'none' // no folder chosen yet
  | 'unsupported' // the browser can't open folders (Firefox, Safari)
  | 'reconnect' // a folder is remembered, but the browser wants permission again
  | 'scanning'
  | 'ready'

/** What a store keeps of its folder. */
export interface FolderFields {
  folderName: string | null
  status: FolderStatus
  images: Picture[]
  /** The picture picked in the list. */
  selectedId: string | null
}

export const FOLDER_DEFAULTS: FolderFields = { folderName: null, status: 'none', images: [], selectedId: null }

/** What every folder's store has (the picked picture may be kept elsewhere, as the curtain's is). */
type FolderBase = Pick<FolderFields, 'folderName' | 'status' | 'images'>

interface FolderStore<S extends FolderBase> {
  getState(): S
  setState(patch: Partial<S> | ((s: S) => Partial<S>)): void
}

export interface PictureFolder {
  choose(): Promise<void>
  /** Permission to read the remembered folder again (needs a click or key press); false if refused. */
  reconnect(): Promise<boolean>
  scan(): Promise<void>
  /** Restore the remembered folder (reading it if the browser still allows). */
  restore(): Promise<void>
}

/** The picked picture, kept if it's still there (else the first). */
function keepSelected(s: FolderBase, found: Picture[]): Partial<FolderFields> {
  const id = (s as Partial<FolderFields>).selectedId
  return { selectedId: id && found.some((f) => f.id === id) ? id : (found[0]?.id ?? null) }
}

/**
 * A folder for a store: `key` names it in storage (and the picker's remembered place).
 * `picked`: what a fresh listing changes besides the pictures (by default, the picked one).
 */
export function pictureFolder<S extends FolderBase>(
  store: FolderStore<S>,
  key: string,
  picked: (s: S, found: Picture[]) => Partial<S> = keepSelected as (s: S, found: Picture[]) => Partial<S>,
): PictureFolder {
  let folder: DirHandle | null = null

  const scan = async () => {
    if (!folder) return
    const dir = folder
    store.setState({ status: 'scanning' } as Partial<S>)
    try {
      const found = await listPictures(dir)
      if (dir !== folder) return // another folder chosen meanwhile
      store.setState((s) => ({
        ...picked(s, found),
        images: samePictures(s.images, found) ? s.images : found,
        status: 'ready',
      }))
    } catch (e) {
      // Moved or deleted, or permission taken back.
      console.warn(`Could not read the ${key} folder`, e)
      store.setState({ status: 'reconnect' } as Partial<S>)
    }
  }

  return {
    scan,
    async choose() {
      const pick = folderPicker()
      if (!pick) return
      let handle: DirHandle
      try {
        handle = await pick({ id: `imaginevtt-${key}`, mode: 'read' })
      } catch {
        return // cancelled
      }
      folder = handle
      await save(`${key}Folder`, handle).catch(() => {})
      store.setState({ folderName: handle.name, ...('selectedId' in store.getState() ? { selectedId: null } : {}) } as Partial<S>)
      await scan()
    },
    async reconnect() {
      if (!folder) return false
      const permission = await folder.requestPermission({ mode: 'read' }).catch(() => 'denied' as const)
      if (permission !== 'granted') return false
      await scan()
      return true
    },
    async restore() {
      if (!folderPicker()) return store.setState({ status: 'unsupported' } as Partial<S>)
      const handle = await load<DirHandle>(`${key}Folder`)
      if (!handle) return
      folder = handle
      store.setState({ folderName: handle.name } as Partial<S>)
      const permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt' as const)
      if (permission === 'granted') void scan()
      else store.setState({ status: 'reconnect' } as Partial<S>)
    },
  }
}
