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

interface FolderStore {
  getState(): FolderFields
  setState(patch: Partial<FolderFields> | ((s: FolderFields) => Partial<FolderFields>)): void
}

export interface PictureFolder {
  choose(): Promise<void>
  reconnect(): Promise<void>
  scan(): Promise<void>
  /** Restore the remembered folder (reading it if the browser still allows). */
  restore(): Promise<void>
}

/** A folder for a store: `key` names it in storage (and the picker's remembered place). */
export function pictureFolder(store: FolderStore, key: string): PictureFolder {
  let folder: DirHandle | null = null

  const scan = async () => {
    if (!folder) return
    const dir = folder
    store.setState({ status: 'scanning' })
    try {
      const found = await listPictures(dir)
      if (dir !== folder) return // another folder chosen meanwhile
      store.setState((s) => ({
        images: samePictures(s.images, found) ? s.images : found,
        status: 'ready',
        selectedId: s.selectedId && found.some((f) => f.id === s.selectedId) ? s.selectedId : (found[0]?.id ?? null),
      }))
    } catch (e) {
      // Moved or deleted, or permission taken back.
      console.warn(`Could not read the ${key} folder`, e)
      store.setState({ status: 'reconnect' })
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
      store.setState({ folderName: handle.name, selectedId: null })
      await scan()
    },
    async reconnect() {
      if (!folder) return
      const permission = await folder.requestPermission({ mode: 'read' }).catch(() => 'denied' as const)
      if (permission === 'granted') await scan()
    },
    async restore() {
      if (!folderPicker()) return store.setState({ status: 'unsupported' })
      const handle = await load<DirHandle>(`${key}Folder`)
      if (!handle) return
      folder = handle
      store.setState({ folderName: handle.name })
      const permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'prompt' as const)
      if (permission === 'granted') void scan()
      else store.setState({ status: 'reconnect' })
    },
  }
}
