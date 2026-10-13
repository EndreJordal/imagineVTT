/**
 * Folder access (File System Access API: in Chromium; not yet in TypeScript's DOM types).
 * Folders are read in place; their handles can be kept in IndexedDB, and the browser asks
 * for permission again on later visits (a click on "Reconnect").
 */
export interface DirHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterable<DirHandle | FileHandle>
  getDirectoryHandle(name: string): Promise<DirHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>
  queryPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

export interface FileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  /** Writing (folders opened 'readwrite' only). */
  createWritable?(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
}

type Picker = (o: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<DirHandle>

/** The folder picker, if the browser has one. */
export const folderPicker = () => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker

/** A picture in a folder. */
export interface Picture {
  /** Path in the folder, e.g. "Intro/Title.jpg": the picture's key (kept in settings). */
  id: string
  /** File name without extension. */
  name: string
  file: File
}

const IMAGE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i

/** A folder's pictures (subfolders too), sorted by path. */
export async function listPictures(dir: DirHandle): Promise<Picture[]> {
  const found: Picture[] = []
  const walk = async (d: DirHandle, path: string) => {
    for await (const entry of d.values()) {
      if (entry.kind === 'directory') await walk(entry, `${path}${entry.name}/`)
      else if (IMAGE.test(entry.name)) {
        found.push({ id: path + entry.name, name: entry.name.replace(/\.[^.]+$/, ''), file: await entry.getFile() })
      }
    }
  }
  await walk(dir, '')
  return found.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/** Whether a rescan found the same pictures (so the list, and its thumbnails, can stay). */
export function samePictures(before: Picture[], found: Picture[]) {
  return (
    before.length === found.length &&
    before.every(
      (b, i) => b.id === found[i].id && b.file.size === found[i].file.size && b.file.lastModified === found[i].file.lastModified,
    )
  )
}
