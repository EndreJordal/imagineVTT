import { create } from 'zustand'
import { sceneFileName } from '../shared/combat'
import { load, save } from '../shared/persist'
import { folderPicker, type DirHandle, type FileHandle } from './folderAccess'

/**
 * The scenes folder: where scenes are saved and found by name (`<name>.ivtt`), so a combat
 * link can open its scene, and saving writes straight back. Remembered between visits; the
 * browser asks again for permission on each visit (on a click).
 */

export type ScenesFolderStatus = 'none' | 'unsupported' | 'reconnect' | 'ready'

export const useScenesFolder = create<{ name: string | null; status: ScenesFolderStatus }>()(() => ({
  name: null,
  status: 'none',
}))

let folder: DirHandle | null = null

/** Restore the remembered folder (ready if the browser still allows writing to it). */
export async function restoreScenesFolder() {
  if (!folderPicker()) return useScenesFolder.setState({ status: 'unsupported' })
  const handle = await load<DirHandle>('scenesFolder')
  if (!handle) return
  folder = handle
  const permission = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt' as const)
  useScenesFolder.setState({ name: handle.name, status: permission === 'granted' ? 'ready' : 'reconnect' })
}

/** Ask for the scenes folder (on a click). */
export async function chooseScenesFolder(): Promise<boolean> {
  const pick = folderPicker()
  if (!pick) return false
  try {
    folder = await pick({ id: 'imaginevtt-scenes', mode: 'readwrite', startIn: 'documents' })
  } catch {
    return false // cancelled
  }
  await save('scenesFolder', folder).catch(() => {})
  useScenesFolder.setState({ name: folder.name, status: 'ready' })
  return true
}

/** The folder, with permission to write (asking for it needs a click). */
async function writableFolder(ask: boolean): Promise<DirHandle | null> {
  if (!folder) return null
  const state = await folder.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt' as const)
  if (state === 'granted') return folder
  if (!ask) return null
  const asked = await folder.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as const)
  if (asked !== 'granted') return null
  useScenesFolder.setState({ status: 'ready' })
  return folder
}

/** Permission to use the remembered folder again (call from a click). */
export const reconnectScenesFolder = async () => !!(await writableFolder(true))

/** A scene's file in the folder, or null if it isn't there (or the folder can't be read). */
export async function findScene(name: string, ask = false): Promise<File | null> {
  const dir = await writableFolder(ask)
  if (!dir) return null
  try {
    return await (await dir.getFileHandle(sceneFileName(name))).getFile()
  } catch {
    return null
  }
}

/** Save a scene into the folder (replacing its file); returns the file's name, or null. */
export async function writeScene(name: string, blob: Blob, ask = false): Promise<string | null> {
  const dir = await writableFolder(ask)
  if (!dir) return null
  const fileName = sceneFileName(name)
  const handle: FileHandle = await dir.getFileHandle(fileName, { create: true })
  if (!handle.createWritable) return null
  const out = await handle.createWritable()
  await out.write(blob)
  await out.close()
  return fileName
}
