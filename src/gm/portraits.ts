import { create } from 'zustand'
import { FOLDER_DEFAULTS, pictureFolder, type FolderFields } from './pictureFolder'
import { useGm } from './store'

/** The portraits folder: pictures for character tokens; the ones used are kept with the scene. */
export const usePortraits = create<FolderFields>()(() => ({ ...FOLDER_DEFAULTS }))

export const portraitFolder = pictureFolder(usePortraits, 'portrait')

/** Put a picture from the folder in a token (it's kept with the scene's images). */
export async function setPortrait(tokenId: string, pictureId: string) {
  const picture = usePortraits.getState().images.find((i) => i.id === pictureId)
  if (!picture) return
  const key = `portrait:${pictureId}`
  const gm = useGm.getState()
  try {
    if (gm.objectImages[key]?.image !== picture.file) {
      const bitmap = await createImageBitmap(picture.file)
      gm.setObjectImage(key, { image: picture.file, width: bitmap.width, height: bitmap.height })
      bitmap.close()
    }
    useGm.getState().updateCharacter(tokenId, { portrait: key, zoom: 1, offsetX: 0, offsetY: 0 })
  } catch {
    gm.notify(`Couldn’t read “${picture.name}” as a picture.`)
  }
}
