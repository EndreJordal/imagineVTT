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
  getFileHandle(name: string): Promise<FileHandle>
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>
}

export interface FileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
}

type Picker = (o: { id?: string; mode?: 'read' }) => Promise<DirHandle>

/** The folder picker, if the browser has one. */
export const folderPicker = () => (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker
