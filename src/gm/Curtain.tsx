import { useEffect } from 'react'
import { CURTAIN_TRANSITIONS, type CurtainTransition } from '../shared/curtain'
import {
  chooseCurtainFolder,
  reconnectCurtainFolder,
  scanCurtainFolder,
  toggleCurtain,
  useCurtain,
  type CurtainPicture,
} from './curtainStore'
import { Icon } from './icons'
import { useThumbnail } from './thumbnails'
import { useRowsBox } from './useRowsBox'
import { Field, Section, Slider } from './ui'

/** Toolbar button: drops a picture over the table instead of the map, or raises it (C). */
export function CurtainButton() {
  const down = useCurtain((s) => s.state.down)
  const status = useCurtain((s) => s.status)
  const hasImages = useCurtain((s) => s.images.length > 0)
  // A remembered folder needs a click to read again: dropping the curtain asks for it.
  const canDrop = status === 'reconnect' || hasImages
  return (
    <button
      className={down ? 'curtain-down' : ''}
      aria-pressed={down}
      disabled={!canDrop && !down}
      title={
        down
          ? 'Raise the curtain: show the map on the table again (C)'
          : canDrop
            ? 'Drop the curtain: show a picture on the table instead of the map (C)'
            : 'Choose a folder of curtain pictures first (Curtain, in the sidebar)'
      }
      onClick={() => void toggleCurtain()}
    >
      <Icon name="curtain" /> {down ? 'Curtain down' : 'Curtain'}
    </button>
  )
}

/** Sidebar section: the curtain folder's pictures, the transition, and the slideshow. */
export function CurtainSection() {
  const state = useCurtain((s) => s.state)
  const images = useCurtain((s) => s.images)
  const list = useRowsBox(3, images.length)
  const status = useCurtain((s) => s.status)
  const folderName = useCurtain((s) => s.folderName)
  const { setCurtain, setSlideshow } = useCurtain.getState()
  const slideshow = state.slideshow
  const ticked = images.filter((i) => slideshow.ids.includes(i.id)).length
  const canSlide = ticked >= 2

  return (
    <Section title="Curtain">
      <Rescan />
      <p className="hint">
        The table shows a picture instead of the map while the curtain is down (<kbd>C</kbd>, or the toolbar
        button); you keep seeing the map.
      </p>
      {status === 'unsupported' && <p className="hint">Picking a folder needs Chrome or Edge.</p>}
      {status === 'none' && (
        <>
          <p className="hint">Put the pictures in a folder, and choose it here.</p>
          <button onClick={() => void chooseCurtainFolder()}>
            <Icon name="folder" /> Choose curtain folder…
          </button>
        </>
      )}
      {status === 'reconnect' && (
        <button onClick={reconnectCurtainFolder} title="The browser asks again on each visit">
          <Icon name="folder" /> Reconnect “{folderName}”
        </button>
      )}
      {(status === 'ready' || status === 'scanning') && (
        <div className="curtain-folder">
          <span className="hint" title="Pictures put in the folder show up when you come back to this window">
            <Icon name="folder" size={14} /> {folderName}
          </span>
          <button onClick={() => void scanCurtainFolder()} disabled={status === 'scanning'}>
            Rescan
          </button>
          <button onClick={() => void chooseCurtainFolder()}>Change…</button>
        </div>
      )}
      {status === 'scanning' && !images.length && <p className="hint">Reading the folder…</p>}
      {status === 'ready' && !images.length && (
        <p className="hint">No pictures in “{folderName}” yet: put JPG, PNG or WebP files in it.</p>
      )}
      {images.length > 0 && (
        <div className="curtain-pictures scrolls" ref={list}>
          {images.map((image) => (
            <Thumb
              key={image.id}
              image={image}
              chosen={!slideshow.on && state.imageId === image.id}
              ticked={slideshow.ids.includes(image.id)}
              dimmed={slideshow.on && !slideshow.ids.includes(image.id)}
            />
          ))}
        </div>
      )}

      <Field label="Transition">
        <select
          value={state.transition}
          onChange={(e) => setCurtain({ transition: e.target.value as CurtainTransition })}
        >
          {CURTAIN_TRANSITIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Slider
        label="Time"
        unit="s"
        value={state.duration}
        fallback={1.5}
        min={0.2}
        max={6}
        step={0.1}
        disabled={state.transition === 'cut'}
        title="How long the transition takes"
        onChange={(duration) => setCurtain({ duration })}
      />
      <div className="segmented" role="radiogroup" aria-label="Picture fit">
        <button
          role="radio"
          aria-checked={state.fit === 'cover'}
          className={state.fit === 'cover' ? 'active' : ''}
          title="Fill the screen, cropping the picture's edges if its shape differs"
          onClick={() => setCurtain({ fit: 'cover' })}
        >
          Fill screen
        </button>
        <button
          role="radio"
          aria-checked={state.fit === 'contain'}
          className={state.fit === 'contain' ? 'active' : ''}
          title="Show the whole picture, with black bars if its shape differs"
          onClick={() => setCurtain({ fit: 'contain' })}
        >
          Whole picture
        </button>
      </div>

      <label
        className={`check${canSlide ? '' : ' disabled'}`}
        title={canSlide ? 'Cycle through the ticked pictures' : 'Tick at least two pictures for the slideshow'}
      >
        <input
          type="checkbox"
          checked={slideshow.on && canSlide}
          disabled={!canSlide}
          onChange={(e) => setSlideshow({ on: e.target.checked })}
        />
        <Icon name="slideshow" /> Slideshow
      </label>
      {!canSlide && images.length > 0 && (
        <p className="hint">Tick at least two pictures (the box on each thumbnail) for a slideshow.</p>
      )}
      {canSlide && <p className="hint">{ticked} pictures ticked, shown in folder order.</p>}
      <Slider
        label="Change every"
        unit="s"
        value={slideshow.interval}
        fallback={10}
        min={2}
        max={120}
        step={1}
        title="How long each picture stays up in the slideshow"
        onChange={(interval) => setSlideshow({ interval })}
      />
    </Section>
  )
}

/** Pictures put in the folder show up when the GM comes back to this window. */
function Rescan() {
  useEffect(() => {
    const rescan = () => {
      if (useCurtain.getState().status === 'ready') void scanCurtainFolder()
    }
    rescan()
    window.addEventListener('focus', rescan)
    return () => window.removeEventListener('focus', rescan)
  }, [])
  return null
}

/**
 * A picture in the picker: click to show it (and stop the slideshow); the tick in its
 * corner puts it in the slideshow.
 */
function Thumb(props: { image: CurtainPicture; chosen: boolean; ticked: boolean; dimmed: boolean }) {
  const { image } = props
  const url = useThumbnail(image)
  return (
    <div className={`curtain-picture${props.dimmed ? ' dimmed' : ''}`}>
      <button
        className={`curtain-thumb${props.chosen ? ' active' : ''}`}
        title={`Show “${image.id}”`}
        aria-pressed={props.chosen}
        onClick={() => {
          const { state, setCurtain } = useCurtain.getState()
          setCurtain({ imageId: image.id, slideshow: { ...state.slideshow, on: false } })
        }}
      >
        {url ? <img src={url} alt="" draggable={false} /> : <span className="curtain-thumb-empty" />}
        <span className="curtain-name">{image.name}</span>
      </button>
      <input
        type="checkbox"
        className="curtain-tick"
        checked={props.ticked}
        title={props.ticked ? 'In the slideshow (untick to leave it out)' : 'Enable for slideshow view'}
        aria-label={`${image.name}: in the slideshow`}
        onChange={() => useCurtain.getState().toggleInSlideshow(image.id)}
      />
    </div>
  )
}
