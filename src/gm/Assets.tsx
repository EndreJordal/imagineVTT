import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { AUDIO_KINDS, VISUAL_KINDS, defaultSquares, isAudio, type AssetKind } from '../shared/arkenAsset'
import type { AssetImage } from '../shared/mapObjects'
import {
  ASSET_DRAG_TYPE,
  assetImage,
  chooseAssetFolder,
  loadSound,
  reconnectAssetFolder,
  scanFolder,
  useAssets,
  type LibraryAsset,
} from './assetLibrary'
import { Section } from './ui'
import { player } from './audio'
import { useGm } from './store'
import { Icon } from './icons'

/** How many results to show at first (more on request): the grid stays quick. */
const PAGE = 60

/** Object URLs for thumbnails, made once per asset (and let go when a rescan replaces one). */
const thumbUrls = new Map<string, { thumb: Blob; url: string }>()
function thumbUrl(asset: LibraryAsset): string | undefined {
  if (!asset.thumb) return undefined
  let entry = thumbUrls.get(asset.path)
  if (entry?.thumb !== asset.thumb) {
    if (entry) URL.revokeObjectURL(entry.url)
    entry = { thumb: asset.thumb, url: URL.createObjectURL(asset.thumb) }
    thumbUrls.set(asset.path, entry)
  }
  return entry.url
}

const startDrag = (asset: LibraryAsset) => (e: DragEvent) => {
  e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.path)
  e.dataTransfer.effectAllowed = 'copy'
}

/** Sidebar section: the asset library, to browse and drag assets onto the map. */
export function AssetsSection() {
  const status = useAssets((s) => s.status)
  const folderName = useAssets((s) => s.folderName)
  const assets = useAssets((s) => s.assets)
  const previewing = useAssets((s) => s.previewing)
  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState<string | null>(null)
  const [audio, setAudio] = useState(false)
  // The kind picked for each half (visual, audio).
  const [kinds, setKinds] = useState<{
    visual: AssetKind | 'All'
    audio: AssetKind | 'All'
  }>({ visual: 'Objects', audio: 'All' })
  const kind = audio ? kinds.audio : kinds.visual
  const setKind = (k: AssetKind | 'All') => setKinds((old) => ({ ...old, [audio ? 'audio' : 'visual']: k }))
  const [playing, setPlaying] = useState<string | null>(null)
  const [chosenCategory, setCategory] = useState<string>('')
  // How many results are shown, for the current search (a new search starts from the top).
  const [more, setMore] = useState({ search: '', count: PAGE })

  const genres = useMemo(() => [...new Set(assets.map((a) => a.genre))].sort(), [assets])
  const inKind = useMemo(
    () =>
      assets.filter(
        (a) => isAudio(a.kind) === audio && (!genre || a.genre === genre) && (kind === 'All' || a.kind === kind),
      ),
    [assets, genre, kind, audio],
  )
  const categories = useMemo(() => [...new Set(inKind.map(topCategory))].sort(), [inKind])
  // A category from another genre or kind no longer applies.
  const category = categories.includes(chosenCategory) ? chosenCategory : ''
  const search = [query, genre, kind, category, audio].join('|')
  const shown = more.search === search ? more.count : PAGE
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return inKind.filter((a) => {
      if (category && topCategory(a) !== category) return false
      const text = `${a.name} ${a.category} ${a.tags.join(' ')}`.toLowerCase()
      return words.every((w) => text.includes(w))
    })
  }, [inKind, category, query])

  return (
    <Section title="Assets">
      {status.kind === 'unsupported' && (
        <p className="hint">The asset library needs Chrome or Edge, which can open a folder on this computer.</p>
      )}
      {status.kind === 'none' && (
        <>
          <button onClick={() => void chooseAssetFolder()}>
            <Icon name="folder" /> Choose asset folder…
          </button>
          <p className="hint">Pick your asset folder (e.g. media-assets). It stays on this computer.</p>
        </>
      )}
      {status.kind === 'reconnect' && (
        <button onClick={() => void reconnectAssetFolder()} title="The browser asks again on each visit">
          <Icon name="folder" /> Reconnect “{folderName}”
        </button>
      )}
      {status.kind === 'scanning' && (
        <p className="hint">
          Indexing assets
          {status.total ? ` ${status.done} / ${status.total}` : '…'}
        </p>
      )}
      {status.kind === 'error' && <p className="hint">Couldn’t read the folder: {status.message}</p>}
      {assets.length > 0 && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Assets">
            {[false, true].map((a) => (
              <button
                key={String(a)}
                role="radio"
                aria-checked={audio === a}
                className={audio === a ? 'active' : ''}
                onClick={() => setAudio(a)}
              >
                {a ? 'Audio' : 'Visual'}
              </button>
            ))}
          </div>
          <input
            type="search"
            className="asset-search"
            placeholder={audio ? 'Search sounds…' : 'Search images…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="chips" role="group" aria-label="Genre">
            <button className={genre === null ? 'active' : ''} onClick={() => setGenre(null)}>
              All
            </button>
            {genres.map((g) => (
              <button key={g} className={genre === g ? 'active' : ''} onClick={() => setGenre(genre === g ? null : g)}>
                {g}
              </button>
            ))}
          </div>
          <div className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind | 'All')} aria-label="Kind">
              <option value="All">All kinds</option>
              {(audio ? AUDIO_KINDS : VISUAL_KINDS).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {audio ? (
            <div className="sound-list">
              {results.slice(0, shown).map((a) => (
                <div key={a.path} className="sound-row" draggable onDragStart={startDrag(a)} title="Drag onto the map">
                  <button
                    className={`icon-button${playing === a.path ? ' active' : ''}`}
                    title={playing === a.path ? 'Stop' : 'Listen (on this computer)'}
                    onClick={() => {
                      if (playing === a.path) {
                        player.stopPreview()
                        setPlaying(null)
                        return
                      }
                      setPlaying(a.path)
                      void loadSound(a.path).then((ok) => {
                        if (ok)
                          void player.previewSound(useGm.getState().soundClips, a.path, () =>
                            setPlaying((p) => (p === a.path ? null : p)),
                          )
                        else setPlaying(null)
                      })
                    }}
                  >
                    <Icon name={playing === a.path ? 'stop' : 'play'} />
                  </button>
                  <span className="sound-row-name">{a.name}</span>
                  <span className="hint">{a.kind === 'Ambience' ? 'ambience' : duration(a.duration)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="asset-grid">
              {results.slice(0, shown).map((a) => (
                <button
                  key={a.path}
                  className={`asset-tile${previewing === a.path ? ' active' : ''}`}
                  title={`${a.name} · ${a.category}`}
                  draggable
                  onDragStart={startDrag(a)}
                  onClick={() => useAssets.getState().setPreviewing(previewing === a.path ? null : a.path)}
                >
                  {thumbUrl(a) ? (
                    <img src={thumbUrl(a)} alt="" draggable={false} />
                  ) : (
                    <span className="asset-none">?</span>
                  )}
                  {a.animated && (
                    <span className="asset-badge" title="Animated">
                      <Icon name="animated" size={11} />
                    </span>
                  )}
                  <span className="asset-name">{a.name}</span>
                </button>
              ))}
            </div>
          )}
          {results.length === 0 && <p className="hint">Nothing matches.</p>}
          {results.length > shown && (
            <button onClick={() => setMore({ search, count: shown + PAGE })}>
              Show more ({results.length - shown} left)
            </button>
          )}
          <p className="hint">
            {audio
              ? 'Press ▶ to listen; drag a sound onto the map to place it.'
              : 'Click an asset to preview it; drag it onto the map to place it.'}{' '}
            {status.kind === 'ready' && (
              <button className="link-button" onClick={() => void scanFolder()} title="Pick up added or changed assets">
                Rescan folder
              </button>
            )}
          </p>
        </>
      )}
    </Section>
  )
}

function duration(seconds: number | undefined) {
  if (!seconds) return ''
  return seconds < 60
    ? `${Math.round(seconds * 10) / 10} s`
    : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

function topCategory(a: LibraryAsset) {
  return a.category.split(' › ')[0]
}

/** Floating panel: a larger look at the asset being previewed. */
export function AssetPreview() {
  const path = useAssets((s) => s.previewing)
  const asset = useAssets((s) => s.assets.find((a) => a.path === s.previewing))
  const ready = useAssets((s) => s.status.kind === 'ready')
  const [image, setImage] = useState<{
    path: string
    image: AssetImage
    url: string
  } | null>(null)
  const [failed, setError] = useState<{ path: string; message: string } | null>(null)
  const error = failed?.path === path ? failed.message : null

  useEffect(() => {
    if (!asset || !ready) return
    let cancelled = false
    assetImage(asset).then(
      (img) => {
        if (cancelled) return
        setImage((old) => {
          if (old) URL.revokeObjectURL(old.url)
          return {
            path: asset.path,
            image: img,
            url: URL.createObjectURL(img.image),
          }
        })
      },
      (err: Error) => !cancelled && setError({ path: asset.path, message: err.message }),
    )
    return () => {
      cancelled = true
    }
  }, [asset, ready])

  if (!path || !asset) return null
  const shown = image?.path === asset.path ? image : null
  const squares = shown && defaultSquares(asset.kind, shown.image.width, shown.image.height, asset.scale)

  return (
    <aside className="light-panel asset-preview" aria-label="Asset preview">
      <header>
        <span className="light-panel-title">{asset.name}</span>
        <button className="icon-button" title="Close" onClick={() => useAssets.getState().setPreviewing(null)}>
          <Icon name="close" />
        </button>
      </header>
      <div className="asset-preview-image" draggable onDragStart={startDrag(asset)} title="Drag onto the map">
        {shown ? (
          shown.image.frames ? (
            <SpriteSheet image={shown.image} url={shown.url} />
          ) : (
            <img src={shown.url} alt={asset.name} draggable={false} />
          )
        ) : (
          thumbUrl(asset) && <img src={thumbUrl(asset)} alt={asset.name} draggable={false} className="loading" />
        )}
      </div>
      <p className="hint">
        {asset.genre} · {asset.kind} · {asset.category}
        {squares && ` · about ${round(squares.width)} × ${round(squares.height)} squares`}
        {shown?.image.frames && ` · ${shown.image.frames.count} frames`}
      </p>
      {error && <p className="hint">Couldn’t load the image: {error}</p>}
      {!ready && <p className="hint">Reconnect the asset folder to see it full size.</p>}
      <p className="hint">Drag it onto the map to place it.</p>
    </aside>
  )
}

const round = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10)

/** Plays an animation's sprite sheet (frames left to right, top to bottom). */
function SpriteSheet({ image, url }: { image: AssetImage; url: string }) {
  const f = image.frames!
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cw = f.frameWidth + 2 * f.pad
    const ch = f.frameHeight + 2 * f.pad
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const n = Math.floor(((now - start) / 1000) * f.fps) % f.count
      const k = el.clientWidth / f.frameWidth
      el.style.backgroundPosition = `${-((n % f.cols) * cw + f.pad) * k}px ${-(Math.floor(n / f.cols) * ch + f.pad) * k}px`
      el.style.backgroundSize = `${f.cols * cw * k}px ${f.rows * ch * k}px`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [f])
  return (
    <div
      ref={ref}
      className="sprite"
      style={{
        backgroundImage: `url(${url})`,
        aspectRatio: `${f.frameWidth} / ${f.frameHeight}`,
      }}
    />
  )
}
