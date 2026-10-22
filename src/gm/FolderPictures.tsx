import { useEffect, type ReactNode } from 'react'
import type { Picture } from './folderAccess'
import { Icon } from './icons'
import type { FolderFields, PictureFolder } from './pictureFolder'
import { useThumbnail } from './thumbnails'
import { useRowsBox } from './useRowsBox'
import { usePictureBrowser } from './pictureBrowser'
import { BrowserBar, FolderTile } from './BrowserBar'

/**
 * A picture folder's controls (choose, reconnect, rescan, change) and its pictures as
 * thumbnails. Pictures put in the folder show up when the GM comes back to this window.
 */
export function FolderPictures(props: {
  state: FolderFields
  folder: PictureFolder
  /** What the pictures are, for the labels: "maps", "pictures". */
  what: string
  /** Thumbnail namespace: folders' paths may match. */
  ns: string
  /** A picture's extras: outline, badge, how it's turned. */
  thumb?: (image: Picture) => { className?: string; title?: string; turn?: number; badge?: ReactNode }
  onSelect(id: string): void
  /** Double-click: the main action (show, use). */
  onOpen?(id: string): void
  /** Rows shown before the pictures scroll in their own box (all, if unset). */
  rows?: number
}) {
  const { state, folder, what } = props
  const { status, folderName, images } = state
  useEffect(() => {
    const rescan = () => {
      if (props.state.status === 'ready') void folder.scan()
    }
    window.addEventListener('focus', rescan)
    return () => window.removeEventListener('focus', rescan)
  }, [folder, props.state.status])

  const browser = usePictureBrowser(images, props.ns)
  // As a list, twice the rows show (they're half as tall as thumbnails).
  const rows = props.rows && (browser.view === 'list' ? props.rows * 2 : props.rows)
  const list = useRowsBox(rows, browser.folders.length + browser.here.length + browser.view.length)

  return (
    <>
      {status === 'unsupported' && <p className="hint">Picking a folder needs Chrome or Edge.</p>}
      {status === 'none' && (
        <>
          <p className="hint">Put the {what} in a folder, and choose it here.</p>
          <button onClick={() => void folder.choose()}>
            <Icon name="folder" /> Choose {what} folder…
          </button>
        </>
      )}
      {status === 'reconnect' && (
        <button onClick={() => void folder.reconnect()} title="The browser asks again on each visit">
          <Icon name="folder" /> Reconnect “{folderName}”
        </button>
      )}
      {(status === 'ready' || status === 'scanning') && (
        <div className="curtain-folder">
          <span className="hint" title={`${what} put in the folder show up when you come back to this window`}>
            <Icon name="folder" size={14} /> {folderName}
          </span>
          <button onClick={() => void folder.scan()} disabled={status === 'scanning'}>
            Rescan
          </button>
          <button onClick={() => void folder.choose()}>Change…</button>
        </div>
      )}
      {status === 'scanning' && !images.length && <p className="hint">Reading the folder…</p>}
      {status === 'ready' && !images.length && (
        <p className="hint">
          No {what} in “{folderName}” yet: put JPG, PNG or WebP files in it.
        </p>
      )}
      {images.length > 0 && <BrowserBar browser={browser} root={folderName ?? what} />}
      {images.length > 0 && (
        <div className={`curtain-pictures${rows ? ' scrolls' : ''}${browser.view === 'list' ? ' as-list' : ''}`} ref={list}>
          {browser.folders.map((f) => (
            <FolderTile key={f.path} folder={f} onOpen={browser.open} />
          ))}
          {browser.here.map((image) => (
            <Thumb
              key={image.id}
              image={image}
              ns={props.ns}
              selected={image.id === state.selectedId}
              extra={props.thumb?.(image)}
              onClick={() => props.onSelect(image.id)}
              onDoubleClick={props.onOpen && (() => props.onOpen!(image.id))}
            />
          ))}
        </div>
      )}
    </>
  )
}

function Thumb(props: {
  image: Picture
  ns: string
  selected: boolean
  extra?: { className?: string; title?: string; turn?: number; badge?: ReactNode }
  onClick(): void
  onDoubleClick?: () => void
}) {
  const { image, extra } = props
  const url = useThumbnail(image, props.ns)
  return (
    <div className="curtain-picture">
      <button
        className={`curtain-thumb${props.selected ? ' active' : ''}${extra?.className ? ` ${extra.className}` : ''}`}
        title={extra?.title ?? `“${image.id}”`}
        aria-pressed={props.selected}
        onClick={props.onClick}
        onDoubleClick={props.onDoubleClick}
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            style={extra?.turn ? { transform: `rotate(${extra.turn * 90}deg)` } : undefined}
          />
        ) : (
          <span className="curtain-thumb-empty" />
        )}
        <span className="curtain-name">{image.name}</span>
        {extra?.badge}
      </button>
    </div>
  )
}
