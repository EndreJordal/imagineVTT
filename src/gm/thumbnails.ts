import { useEffect, useState } from 'react'
import type { Picture } from './folderAccess'

/** Thumbnails of pictures in folders (curtain, show to players). */

const THUMB_PX = 240

/** Thumbnails made this visit, by picture (and its size and date: a changed file gets a new one). */
const thumbs = new Map<string, { key: string; url: Promise<string | null> }>()
/** One at a time, so a folder of big photos doesn't stall the page. */
let queue: Promise<unknown> = Promise.resolve()

function thumbnail(image: Picture, ns: string): Promise<string | null> {
  const key = `${image.file.size}|${image.file.lastModified}`
  const made = thumbs.get(ns + image.id)
  if (made?.key === key) return made.url
  if (made) void made.url.then((old) => old && URL.revokeObjectURL(old))
  const url = queue.then(async () => {
    try {
      const bitmap = await createImageBitmap(image.file, { resizeWidth: THUMB_PX, resizeQuality: 'medium' })
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      bitmap.close()
      return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }))
    } catch {
      return null // not a picture the browser can read
    }
  })
  queue = url
  thumbs.set(ns + image.id, { key, url })
  return url
}

/** A picture's thumbnail (`ns` keeps folders' pictures apart: their paths may match). */
export function useThumbnail(image: Picture, ns = 'curtain:') {
  const [shown, setShown] = useState<{ image: Picture; url: string | null } | null>(null)
  useEffect(() => {
    let live = true
    void thumbnail(image, ns).then((url) => live && setShown({ image, url }))
    return () => {
      live = false
    }
  }, [image, ns])
  return shown?.image === image ? shown.url : null
}
