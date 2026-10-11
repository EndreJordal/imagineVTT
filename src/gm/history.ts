import type { Scene } from '../shared/types'
import { useGm } from './store'

/**
 * Undo/redo of scene edits (walls, doors, lights, map, grid, PVB, night…). A snapshot is the
 * scene plus the map image: scenes are replaced, never changed in place, so keeping one is
 * just keeping a reference. Fog memory isn't undone: exploring isn't an edit.
 *
 * A burst of changes (a drag, a slider) is one step: a step opens with the first change and
 * closes once nothing has changed for a moment and no pointer is held down.
 */
interface Snapshot {
  scene: Scene
  mapImage: Blob | null
}

const LIMIT = 100
const QUIET_MS = 500

let past: Snapshot[] = []
let future: Snapshot[] = []
let burstOpen = false
let burstTimer: number | undefined
let pressed = false
let applying = false

function publish() {
  useGm.setState({ history: { canUndo: past.length > 0, canRedo: future.length > 0 } })
}

function closeBurst() {
  window.clearTimeout(burstTimer)
  burstOpen = false
}

function scheduleClose() {
  window.clearTimeout(burstTimer)
  burstTimer = window.setTimeout(() => {
    // Still dragging (held still): keep the step open.
    if (pressed) scheduleClose()
    else burstOpen = false
  }, QUIET_MS)
}

/** Start recording scene changes; returns a function that stops it. */
export function startHistory(): () => void {
  past = []
  future = []
  closeBurst()
  publish()
  const onDown = () => {
    pressed = true
  }
  const onUp = () => {
    pressed = false
    if (burstOpen) scheduleClose()
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onUp, true)
  const unsubscribe = useGm.subscribe((s, prev) => {
    if (s.historyEpoch !== prev.historyEpoch) {
      // A different scene (opened, or new): its history starts afresh.
      past = []
      future = []
      closeBurst()
      publish()
      return
    }
    if (applying || (s.scene === prev.scene && s.mapImage === prev.mapImage)) return
    if (!burstOpen) {
      past.push({ scene: prev.scene, mapImage: prev.mapImage })
      if (past.length > LIMIT) past.shift()
      burstOpen = true
    }
    future = []
    publish()
    scheduleClose()
  })
  return () => {
    unsubscribe()
    closeBurst()
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onUp, true)
  }
}

function current(): Snapshot {
  const { scene, mapImage } = useGm.getState()
  return { scene, mapImage }
}

function apply(snapshot: Snapshot) {
  applying = true
  useGm.setState((s) => ({
    scene: snapshot.scene,
    mapImage: snapshot.mapImage,
    // Selections may point at things that are gone (or wall points that were renumbered).
    selectedLightIds: s.selectedLightIds.filter((id) => snapshot.scene.lights.some((l) => l.id === id)),
    selectedWallPoints: [],
    wallDraft: [],
    doorDraft: null,
  }))
  applying = false
  publish()
}

export function undo() {
  closeBurst()
  const snapshot = past.pop()
  if (!snapshot) return
  future.push(current())
  apply(snapshot)
}

export function redo() {
  closeBurst()
  const snapshot = future.pop()
  if (!snapshot) return
  past.push(current())
  apply(snapshot)
}
