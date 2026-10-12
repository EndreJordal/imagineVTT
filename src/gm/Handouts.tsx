import { useEffect } from 'react'
import type { Picture } from './folderAccess'
import {
  chooseHandoutFolder,
  hideHandout,
  reconnectHandoutFolder,
  scanHandoutFolder,
  showHandout,
  useHandouts,
} from './handoutStore'
import { useThumbnail } from './thumbnails'
import { Icon } from './icons'
import { Section } from './ui'

/** Sidebar section: pictures from a folder, shown to the players framed over the map. */
export function HandoutsSection() {
  const images = useHandouts((s) => s.images)
  const status = useHandouts((s) => s.status)
  const folderName = useHandouts((s) => s.folderName)
  const selectedId = useHandouts((s) => s.selectedId)
  const shown = useHandouts((s) => s.shown)
  const turns = useHandouts((s) => s.turns)
  const fill = useHandouts((s) => s.fill)
  const { select, turn, setFill } = useHandouts.getState()
  const selected = images.find((i) => i.id === selectedId)
  const showing = shown && images.find((i) => i.id === shown.id)

  return (
    <Section title={showing ? 'Show to players • showing' : 'Show to players'}>
      <Rescan />
      <p className="hint">Show the players a picture (a map, a letter, a portrait), framed over the map on the table.</p>
      {status === 'unsupported' && <p className="hint">Picking a folder needs Chrome or Edge.</p>}
      {status === 'none' && (
        <>
          <p className="hint">Put the pictures in a folder, and choose it here.</p>
          <button onClick={() => void chooseHandoutFolder()}>
            <Icon name="folder" /> Choose pictures folder…
          </button>
        </>
      )}
      {status === 'reconnect' && (
        <button onClick={() => void reconnectHandoutFolder()} title="The browser asks again on each visit">
          <Icon name="folder" /> Reconnect “{folderName}”
        </button>
      )}
      {(status === 'ready' || status === 'scanning') && (
        <div className="curtain-folder">
          <span className="hint">
            <Icon name="folder" size={14} /> {folderName}
          </span>
          <button onClick={() => void scanHandoutFolder()} disabled={status === 'scanning'}>
            Rescan
          </button>
          <button onClick={() => void chooseHandoutFolder()}>Change…</button>
        </div>
      )}
      {status === 'ready' && !images.length && (
        <p className="hint">No pictures in “{folderName}” yet: put JPG, PNG or WebP files in it.</p>
      )}
      {images.length > 0 && (
        <div className="curtain-pictures">
          {images.map((image) => (
            <Thumb
              key={image.id}
              image={image}
              turn={turns[image.id] ?? 0}
              selected={image.id === selectedId}
              showing={image.id === shown?.id}
              onClick={() => select(image.id)}
            />
          ))}
        </div>
      )}
      {selected && (
        <>
          <div className="row handout-turns">
            <button className="icon-button" title="Turn 90° left" onClick={() => turn(selected.id, -1)}>
              <Icon name="turn-left" />
            </button>
            <button title="Turn 180°" onClick={() => turn(selected.id, 2)}>
              180°
            </button>
            <button className="icon-button" title="Turn 90° right" onClick={() => turn(selected.id, 1)}>
              <Icon name="turn-right" />
            </button>
            <span className="hint">{(turns[selected.id] ?? 0) * 90}°</span>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Picture size">
            <button
              role="radio"
              aria-checked={!fill}
              className={fill ? '' : 'active'}
              title="Its own size, or smaller to fit the screen"
              onClick={() => setFill(false)}
            >
              Own size
            </button>
            <button
              role="radio"
              aria-checked={fill}
              className={fill ? 'active' : ''}
              title="As big as the screen allows: cropped at the sides if its shape differs"
              onClick={() => setFill(true)}
            >
              Fill screen
            </button>
          </div>
          {shown?.id === selected.id ? (
            <button className="active" onClick={hideHandout}>
              <Icon name="hide" /> Hide from players
            </button>
          ) : (
            <button onClick={() => void showHandout(selected.id)}>
              <Icon name="peek" /> Show to players
            </button>
          )}
        </>
      )}
      {showing && shown.id !== selectedId && (
        <button onClick={hideHandout} title={`Showing “${showing.name}”`}>
          <Icon name="hide" /> Hide “{showing.name}”
        </button>
      )}
    </Section>
  )
}

/** Pictures put in the folder show up when the GM comes back to this window. */
function Rescan() {
  useEffect(() => {
    const rescan = () => {
      if (useHandouts.getState().status === 'ready') void scanHandoutFolder()
    }
    rescan()
    window.addEventListener('focus', rescan)
    return () => window.removeEventListener('focus', rescan)
  }, [])
  return null
}

function Thumb(props: { image: Picture; turn: number; selected: boolean; showing: boolean; onClick(): void }) {
  const { image } = props
  const url = useThumbnail(image, 'handout:')
  return (
    <div className="curtain-picture">
      <button
        className={`curtain-thumb${props.selected ? ' active' : ''}${props.showing ? ' showing' : ''}`}
        title={props.showing ? `“${image.id}”: showing to the players` : `“${image.id}”`}
        aria-pressed={props.selected}
        onClick={props.onClick}
        onDoubleClick={() => void showHandout(image.id)}
      >
        {url ? (
          <img src={url} alt="" draggable={false} style={{ transform: `rotate(${props.turn * 90}deg)` }} />
        ) : (
          <span className="curtain-thumb-empty" />
        )}
        <span className="curtain-name">{image.name}</span>
        {props.showing && (
          <span className="handout-badge" title="Showing to the players">
            <Icon name="peek" size={12} />
          </span>
        )}
      </button>
    </div>
  )
}
