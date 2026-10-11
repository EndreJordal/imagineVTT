import { useGm } from './store'
import { Slider } from './ui'

/** Floating panel for the selected object: size, rotation, order, removal. */
export function ObjectPanel() {
  const object = useGm((s) => (s.selectedObjectIds.length === 1 ? s.scene.objects.find((o) => o.id === s.selectedObjectIds[0]) : undefined))
  const square = useGm((s) => s.scene.grid.size)
  if (!object) return null
  const { updateObject, removeObjects, reorderObject, selectObject } = useGm.getState()
  const degrees = Math.round(((((object.rotation * 180) / Math.PI) % 360) + 360) % 360)
  const aspect = object.height / object.width

  return (
    <aside className="light-panel" aria-label="Object settings">
      <header>
        <span className="light-panel-title">{object.name}</span>
        <button className="icon-button" title="Close" onClick={() => selectObject(null)}>
          ✕
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
      <div className="row">
        <button onClick={() => reorderObject(object.id, 'front')} title="Draw it over the other objects">
          Bring to front
        </button>
        <button onClick={() => reorderObject(object.id, 'back')} title="Draw it under the other objects">
          Send to back
        </button>
      </div>
      <p className="hint">Drag to move; drag a corner to resize, the top handle to rotate (Shift: 15° steps).</p>
      <button onClick={() => removeObjects([object.id])}>Remove object</button>
    </aside>
  )
}
