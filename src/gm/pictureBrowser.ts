/**
 * Browsing a picture folder's subfolders, one level at a time, as a list or as thumbnails.
 * Where each list is (and how it shows) is remembered per list, per browser.
 */
import { useEffect, useMemo, useState } from 'react'
import type { Picture } from './folderAccess'

export interface Subfolder {
  name: string
  /** Its path in the folder, ending in '/'. */
  path: string
  /** Pictures in it, its own subfolders included. */
  count: number
}

/** What's in `path` ('' for the folder itself, else ending in '/'): its subfolders and pictures. */
export function browse(images: Picture[], path: string): { folders: Subfolder[]; here: Picture[] } {
  const folders = new Map<string, Subfolder>()
  const here: Picture[] = []
  for (const image of images) {
    if (!image.id.startsWith(path)) continue
    const rest = image.id.slice(path.length)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      here.push(image)
      continue
    }
    const name = rest.slice(0, slash)
    const f = folders.get(name) ?? { name, path: `${path}${name}/`, count: 0 }
    f.count++
    folders.set(name, f)
  }
  return { folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), here }
}

export type BrowseView = 'thumbs' | 'list'

interface Saved {
  path: string
  view: BrowseView
}

const storageKey = (key: string) => `imaginevtt.browse.${key}`

function load(key: string): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(key)) ?? 'null')
    if (saved && typeof saved.path === 'string') return { path: saved.path, view: saved.view === 'list' ? 'list' : 'thumbs' }
  } catch {
    // Unavailable: from the top, as thumbnails.
  }
  return { path: '', view: 'thumbs' }
}

export interface PictureBrowser {
  path: string
  open(path: string): void
  view: BrowseView
  setView(view: BrowseView): void
  folders: Subfolder[]
  here: Picture[]
}

/** Browse `images` (a folder's pictures): `key` names the list, for remembering it. */
export function usePictureBrowser(images: Picture[], key: string): PictureBrowser {
  const [saved, setSaved] = useState(() => load(key))
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(key), JSON.stringify(saved))
    } catch {
      // Not remembered, that's all.
    }
  }, [key, saved])
  // A remembered subfolder that's gone (renamed, another folder chosen): back to the top.
  const path = saved.path && images.length && !images.some((i) => i.id.startsWith(saved.path)) ? '' : saved.path
  const { folders, here } = useMemo(() => browse(images, path), [images, path])
  return {
    path,
    open: (p) => setSaved((s) => ({ ...s, path: p })),
    view: saved.view,
    setView: (view) => setSaved((s) => ({ ...s, view })),
    folders,
    here,
  }
}
