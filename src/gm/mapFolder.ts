import { create } from 'zustand'
import { FOLDER_DEFAULTS, pictureFolder, type FolderFields } from './pictureFolder'
import { useGm } from './store'

/** The maps folder: the GM's map images, read in place; the one used is kept with the scene. */
export const useMapFolder = create<FolderFields>()(() => ({ ...FOLDER_DEFAULTS }))

export const mapFolder = pictureFolder(useMapFolder, 'map')

/** Make a picture in the folder the scene's map. */
export async function chooseMap(id: string) {
  const image = useMapFolder.getState().images.find((i) => i.id === id)
  if (!image) return
  try {
    const bitmap = await createImageBitmap(image.file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    useGm.getState().setMap(image.file, size)
  } catch {
    useGm.getState().notify(`Couldn’t read “${image.name}” as a picture.`)
  }
}

/** Whether a folder picture is (most likely) the map in use: same size and type of file. */
export const isMapInUse = (file: File, map: Blob | null) => !!map && map.size === file.size && map.type === file.type
