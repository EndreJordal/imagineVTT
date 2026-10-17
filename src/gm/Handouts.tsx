import { handoutFolder, hideHandout, showHandout, useHandouts } from './handoutStore'
import { Icon } from './icons'
import { FolderPictures } from './FolderPictures'
import { Section } from './ui'

/** Sidebar section: pictures from a folder, shown to the players framed over the map. */
export function HandoutsSection() {
  const state = useHandouts()
  const { images, selectedId, shown, turns, fill } = state
  const { select, turn, setFill } = useHandouts.getState()
  const selected = images.find((i) => i.id === selectedId)
  const showing = shown && images.find((i) => i.id === shown.id)

  return (
    <Section title={showing ? 'Show to players • showing' : 'Show to players'}>
      <p className="hint">Show the players a picture (a map, a letter, a portrait), framed over the map on the table.</p>
      <FolderPictures
        state={state}
        folder={handoutFolder}
        what="pictures"
        ns="handout:"
        rows={3}
        onSelect={select}
        onOpen={(id) => void showHandout(id)}
        thumb={(image) => ({
          turn: turns[image.id] ?? 0,
          ...(image.id === shown?.id && {
            className: 'showing',
            title: `“${image.id}”: showing to the players`,
            badge: (
              <span className="handout-badge" title="Showing to the players">
                <Icon name="peek" size={12} />
              </span>
            ),
          }),
        })}
      />
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
