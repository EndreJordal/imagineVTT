import { turnFogMemory } from '../shared/fog'
import type { Level } from '../shared/levels'
import type { Scene } from '../shared/types'
import { useGm } from './store'
import { selectionIn } from './slices/shared'

/**
 * Undo/redo of scene edits (walls, doors, lights, map, grid, PVB, night…). A snapshot is the
 * scene plus the map image: scenes are replaced, never changed in place, so keeping one is
 * just keeping a reference. Fog memory isn't undone: exploring isn't an edit.
 *
 * With floors, a snapshot is all of them, and which floor was being viewed: undoing goes
 * back to the floor where the change was made. Just looking at another floor isn't a step.
 *
 * A burst of changes (a drag, a slider) is one step: a step opens with the first change and
 * closes once nothing has changed for a moment and no pointer is held down.
 */
interface Snapshot {
  scene: Scene
  mapImage: Blob | null
  levels: Level[]
  levelImages: Record<string, Blob | null>
  levelId: string
  tableLevelId: string
  /** The acting combatant's movement this turn: undoing a move takes it off. */
  turnMove: State['turnMove']
}

type State = ReturnType<typeof useGm.getState>
const snapshot = (s: State): Snapshot => ({
  scene: s.scene,
  mapImage: s.mapImage,
  levels: s.levels,
  levelImages: s.levelImages,
  levelId: s.levelId,
  tableLevelId: s.tableLevelId,
  turnMove: s.turnMove,
})
const edited = (s: State, prev: State) =>
  s.scene !== prev.scene ||
  s.mapImage !== prev.mapImage ||
  s.levels !== prev.levels ||
  s.levelImages !== prev.levelImages ||
  s.tableLevelId !== prev.tableLevelId

const LIMIT = 100
const QUIET_MS = 500

let past: Snapshot[] = []
let future: Snapshot[] = []
let burstOpen = false
let burstTimer: number | undefined
let pressed = false
let applying = false

/** Tell the UI whether undo and redo are possible (only when that changes: every edit lands here). */
function publish() {
  const canUndo = past.length > 0
  const canRedo = future.length > 0
  const { history } = useGm.getState()
  if (history.canUndo !== canUndo || history.canRedo !== canRedo) useGm.setState({ history: { canUndo, canRedo } })
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
    if (applying || !edited(s, prev)) return
    // Viewing another floor: not an edit (a step in progress ends, though).
    if (s.levelId !== prev.levelId) {
      closeBurst()
      return
    }
    if (!burstOpen) {
      past.push(snapshot(prev))
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
  return snapshot(useGm.getState())
}

/** Quarter turns of a floor's map, in the store or in a snapshot. */
function turnsOf(state: Pick<Snapshot, 'scene' | 'levels' | 'levelId'>, id: string) {
  const map = id === state.levelId ? state.scene.map : state.levels.find((l) => l.id === id)?.map
  return map?.turns ?? 0
}

function apply(snapshot: Snapshot) {
  applying = true
  useGm.setState((s) => {
    // Back on another floor: its fog memory comes back with it (fog isn't undone).
    let fogMemory = s.fogMemory
    let levelFog = s.levelFog
    if (snapshot.levelId !== s.levelId) {
      levelFog = { ...s.levelFog, [s.levelId]: s.fogMemory }
      fogMemory = s.levelFog[snapshot.levelId] ?? null
    }
    // ...but a map turned (or turned back) takes what's been explored with it.
    let turned = false
    for (const id of new Set([snapshot.levelId, ...snapshot.levels.map((l) => l.id)])) {
      const delta = turnsOf(snapshot, id) - turnsOf(s, id)
      if (!delta) continue
      turned = true
      if (id === snapshot.levelId) fogMemory = fogMemory && turnFogMemory(fogMemory, delta)
      else if (levelFog[id]) levelFog = { ...levelFog, [id]: turnFogMemory(levelFog[id], delta) }
    }
    const fogChanged = snapshot.levelId !== s.levelId || turned
    return {
      ...snapshot,
      ...(fogChanged && { fogMemory, levelFog, fogVersion: s.fogVersion + 1 }),
      // Selections may point at things that are gone (or wall points that were renumbered).
      ...selectionIn(s, snapshot.scene),
      wallDraft: [],
      doorDraft: null,
    }
  })
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
