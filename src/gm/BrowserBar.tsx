import { Icon } from './icons'
import type { PictureBrowser, Subfolder } from './pictureBrowser'

/** Where in the folder the list is (each part goes back up to it), and list or thumbnails. */
export function BrowserBar({ browser, root }: { browser: PictureBrowser; root: string }) {
  const parts = browser.path.split('/').filter(Boolean)
  return (
    <div className="browser-bar">
      <nav className="browser-crumbs" aria-label="Folder">
        <button disabled={!parts.length} title="Up a folder" aria-label="Up a folder"
          onClick={() => browser.open(parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '')}>
          <Icon name="left" size={12} />
        </button>
        <button className="crumb" onClick={() => browser.open('')} disabled={!parts.length}>
          {root}
        </button>
        {parts.map((p, i) => (
          <span key={i} className="crumb-part">
            /
            <button className="crumb" disabled={i === parts.length - 1} onClick={() => browser.open(`${parts.slice(0, i + 1).join('/')}/`)}>
              {p}
            </button>
          </span>
        ))}
      </nav>
      <div className="segmented browser-view" role="radiogroup" aria-label="Show as">
        {(['thumbs', 'list'] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={browser.view === v}
            className={browser.view === v ? 'active' : ''}
            title={v === 'thumbs' ? 'Thumbnails' : 'List'}
            onClick={() => browser.setView(v)}
          >
            {v === 'thumbs' ? '▦' : '☰'}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A subfolder in the list: click to go into it. */
export function FolderTile({ folder, onOpen }: { folder: Subfolder; onOpen(path: string): void }) {
  return (
    <div className="curtain-picture">
      <button className="curtain-thumb folder-tile" title={`Open “${folder.name}”`} onClick={() => onOpen(folder.path)}>
        <span className="folder-icon">
          <Icon name="folder" size={28} />
        </span>
        <span className="curtain-name">
          {folder.name} <span className="hint">{folder.count}</span>
        </span>
      </button>
    </div>
  )
}
