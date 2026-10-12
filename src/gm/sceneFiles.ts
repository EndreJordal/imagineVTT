import {
  readSceneFile,
  SCENE_FILE_EXTENSION,
  SceneFileError,
  sceneNameFromFile,
  writeSceneFile,
} from '../shared/sceneFile'
import { allLevels, levelFogMemory, levelImage, useGm } from './store'

/**
 * Saving and opening scene files. Where the browser can write files (Chrome, Edge), the
 * file a scene came from or was saved to is remembered, so saving again writes back to it;
 * elsewhere, saving downloads a file and opening uses a file picker.
 */

// Minimal File System Access API types (Chromium only; not in TypeScript's DOM lib).
interface WritableFile {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}
interface FileHandle {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<WritableFile>
}
type PickerOptions = {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}
interface FileSystemAccessWindow {
  showSaveFilePicker?(options: PickerOptions): Promise<FileHandle>
  showOpenFilePicker?(options: PickerOptions): Promise<FileHandle[]>
}
const fsa = window as unknown as FileSystemAccessWindow

const TYPES = [{ description: 'imagineVTT scene', accept: { 'application/zip': [SCENE_FILE_EXTENSION] } }]

/** The file the open scene lives in (this page session only). */
let handle: FileHandle | null = null

/** Save the scene: back to its file, or to a new one (`saveAs`, or the first save). */
export async function saveScene(saveAs = false) {
  const s = useGm.getState()
  const blob = await writeSceneFile({
    scene: s.scene,
    orientation: s.display.orientation,
    camera: s.gmCamera,
    levels: allLevels(s),
    levelId: s.levelId,
    tableLevelId: s.tableLevelId,
    mapImages: Object.fromEntries(s.levels.map((l) => [l.id, levelImage(s, l.id)])),
    fogMemories: Object.fromEntries(s.levels.map((l) => [l.id, levelFogMemory(s, l.id)])),
    objectImages: s.objectImages,
    soundClips: s.soundClips,
  })
  const suggestedName = `${s.sceneName ?? 'Untitled scene'}${SCENE_FILE_EXTENSION}`

  if (fsa.showSaveFilePicker) {
    try {
      if (!handle || saveAs) handle = await fsa.showSaveFilePicker({ suggestedName, types: TYPES })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      s.markSaved(sceneNameFromFile(handle.name))
    } catch (err) {
      if (!isCancel(err)) alert(`Could not save the scene: ${String(err)}`)
    }
    return
  }

  // No file system access: download it.
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  s.markSaved(sceneNameFromFile(suggestedName))
}

/** Ask for a scene file and open it. */
export async function openScene() {
  if (!confirmDiscard()) return
  if (fsa.showOpenFilePicker) {
    try {
      const [picked] = await fsa.showOpenFilePicker({ types: TYPES })
      await load(await picked.getFile(), picked)
    } catch (err) {
      if (!isCancel(err)) alert(`Could not open the scene: ${String(err)}`)
    }
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = SCENE_FILE_EXTENSION
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) void load(file, null)
  }
  input.click()
}

/** Start a new, empty scene (asking first if there are unsaved changes). */
export function newScene() {
  if (!confirmDiscard()) return
  useGm.getState().newScene()
  handle = null
}

/** Open a scene file dropped on the window. */
export async function openDroppedScene(item: DataTransferItem) {
  const file = item.getAsFile()
  if (!file || !file.name.toLowerCase().endsWith(SCENE_FILE_EXTENSION)) return false
  if (!confirmDiscard()) return true
  // Chromium can hand over a writable handle for dropped files, so saving goes back to it.
  const dropped = item as DataTransferItem & { getAsFileSystemHandle?(): Promise<FileHandle | null> }
  const fileHandle = dropped.getAsFileSystemHandle ? await dropped.getAsFileSystemHandle() : null
  await load(file, fileHandle)
  return true
}

async function load(file: File, fileHandle: FileHandle | null) {
  try {
    const scene = await readSceneFile(file)
    useGm.getState().loadScene(scene, sceneNameFromFile(file.name))
    handle = fileHandle
  } catch (err) {
    alert(err instanceof SceneFileError ? err.message : `Could not open the scene: ${String(err)}`)
  }
}

function confirmDiscard() {
  const { unsaved, sceneName } = useGm.getState()
  if (!unsaved) return true
  return confirm(`Discard unsaved changes to "${sceneName ?? 'Untitled scene'}"?`)
}

function isCancel(err: unknown) {
  return err instanceof DOMException && err.name === 'AbortError'
}
