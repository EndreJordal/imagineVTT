import type { ObjectVisibility } from '../shared/mapObjects'
import { useGm } from './store'
import { Slider, Switch } from './ui'
import { Icon } from './icons'

const SEEN_AS: { value: ObjectVisibility; label: string; hint: string }[] = [
  {
    value: 'map',
    label: 'Like the map',
    hint: 'Always there, like the map: greyscale out of sight, hidden where unexplored.',
  },
  {
    value: 'sight',
    label: 'Only in sight',
    hint: 'Shown only while a vision token sees it, gone again when none does.',
  },
  {
    value: 'seen',
    label: 'Once seen',
    hint: 'Hidden until a vision token sees it, then like the map.',
  },
  {
    value: 'hidden',
    label: 'Hidden',
    hint: 'Hidden from the players until you reveal it (whatever’s obscured), then like the map. You see it faintly while hidden.',
  },
]

/** Floating panel for the selected object: size, rotation, order, removal. */
export function ObjectPanel() {
  const object = useGm((s) => (s.selectedObjectIds.length === 1 ? s.scene.objects.find((o) => o.id === s.selectedObjectIds[0]) : undefined))
  const square = useGm((s) => s.scene.grid.size)
  if (!object) return null
  const { updateObject, removeObjects, reorderObject, selectObject } = useGm.getState()
  const degrees = Math.round(((((object.rotation * 180) / Math.PI) % 360) + 360) % 360)
  const aspect = object.height / object.width
  const visibility = object.visibility ?? 'map'

  return (
    <aside className="light-panel" aria-label="Object settings">
      <header>
        <span className="light-panel-title">{object.name}</span>
        <button className="icon-button" title="Close" onClick={() => selectObject(null)}>
          <Icon name="close" />
        </button>
      </header>
      <Slider
        label="Width"
        unit="sq"
        value={Math.round((object.width / square) * 100) / 100}
        fallback={1}
        min={0.25}
        max={40}
        step={0.25}
        onChange={(w) => updateObject(object.id, { width: w * square, height: w * square * aspect })}
      />
      <Slider
        label="Rotation"
        unit="°"
        value={degrees}
        fallback={0}
        min={0}
        max={359}
        step={1}
        onChange={(d) => updateObject(object.id, { rotation: (d * Math.PI) / 180 })}
      />
      <span className="slider-label">Players see it</span>
      <div className="segmented" role="radiogroup" aria-label="Players see it">
        {SEEN_AS.map((v) => (
          <button
            key={v.value}
            role="radio"
            aria-checked={visibility === v.value}
            className={visibility === v.value ? 'active' : ''}
            onClick={() => updateObject(object.id, { visibility: v.value })}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="hint">{SEEN_AS.find((v) => v.value === visibility)!.hint}</p>
      {visibility === 'hidden' && (
        <Switch
          left="Revealed"
          right="Hidden"
          on={!object.seen}
          title="Whether the players see it (you always do)"
          onChange={(hidden) => updateObject(object.id, { seen: !hidden })}
        />
      )}
      {visibility === 'seen' && (
        <div className="row">
          <span className="hint">{object.seen ? 'Seen by the party.' : 'Not seen yet.'}</span>
          {object.seen && (
            <button onClick={() => updateObject(object.id, { seen: false })} title="Hidden until seen again">
              Unsee
            </button>
          )}
        </div>
      )}
      <div className="row">
        <button onClick={() => reorderObject(object.id, 'front')} title="Draw it over the other objects">
          Bring to front
        </button>
        <button onClick={() => reorderObject(object.id, 'back')} title="Draw it under the other objects">
          Send to back
        </button>
      </div>
      <p className="hint">
        Drag to move; drag a corner to resize, the top handle to rotate (Shift: 15° steps). <kbd>Ctrl</kbd>
        +click the map to drop copies.
      </p>
      <button onClick={() => removeObjects([object.id])}>Remove object</button>
    </aside>
  )
}

/** The one value all have, or undefined when they differ (a mixed setting). */
function shared<T>(values: T[]): T | undefined {
  return values.every((v) => v === values[0]) ? values[0] : undefined
}

/** Floating panel for several selected objects: what they share, changed for all at once. */
export function ObjectsPanel() {
  const ids = useGm((s) => s.selectedObjectIds)
  const all = useGm((s) => s.scene.objects)
  const square = useGm((s) => s.scene.grid.size)
  if (ids.length < 2) return null
  const objects = all.filter((o) => ids.includes(o.id))
  const { updateObjects, removeObjects, selectObject } = useGm.getState()
  const width = shared(objects.map((o) => Math.round((o.width / square) * 100) / 100))
  const degrees = shared(objects.map((o) => Math.round(((((o.rotation * 180) / Math.PI) % 360) + 360) % 360)))
  const visibility = shared(objects.map((o) => o.visibility ?? 'map'))
  const hidden = shared(objects.map((o) => !o.seen))

  return (
    <aside className="light-panel" aria-label="Objects settings">
      <header>
        <span className="light-panel-title">{objects.length} objects selected</span>
        <button className="icon-button" title="Close" onClick={() => selectObject(null)}>
          <Icon name="close" />
        </button>
      </header>
      <Slider
        label="Width"
        unit="sq"
        value={width}
        fallback={1}
        min={0.25}
        max={40}
        step={0.25}
        title="Each keeps its shape"
        onChange={(w) => updateObjects(ids, (o) => ({ width: w * square, height: w * square * (o.height / o.width) }))}
      />
      <Slider
        label="Rotation"
        unit="°"
        value={degrees}
        fallback={0}
        min={0}
        max={359}
        step={1}
        onChange={(d) => updateObjects(ids, { rotation: (d * Math.PI) / 180 })}
      />
      <span className="slider-label">Players see it</span>
      <div className="segmented" role="radiogroup" aria-label="Players see it">
        {SEEN_AS.map((v) => (
          <button
            key={v.value}
            role="radio"
            aria-checked={visibility === v.value}
            className={visibility === v.value ? 'active' : ''}
            onClick={() => updateObjects(ids, { visibility: v.value })}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="hint">{visibility ? SEEN_AS.find((v) => v.value === visibility)!.hint : 'Mixed: pick one to set it for all.'}</p>
      {visibility === 'hidden' && (
        <Switch
          left="Revealed"
          right="Hidden"
          on={hidden !== false}
          title={hidden === undefined ? 'Some revealed, some hidden: click to set all' : 'Whether the players see them'}
          onChange={(hide) => updateObjects(ids, { seen: !hide })}
        />
      )}
      <p className="hint">
        Drag any of them to move them together. <kbd>Shift</kbd>+click adds or takes one out; <kbd>Shift</kbd>+drag
        draws a box.
      </p>
      <button onClick={() => removeObjects(ids)}>Remove {objects.length} objects</button>
    </aside>
  )
}
