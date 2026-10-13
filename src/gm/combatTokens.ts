import { portraitKeyOf, type CombatSummary } from '../shared/combat'
import type { Point } from '../shared/types'
import { useGm } from './store'

/** What a combatant's coin carries when it's dragged from the Combat section onto the map. */
export const COMBATANT_DRAG_TYPE = 'application/x-imaginevtt-combatant'

/** Portraits being fetched, by URL (so each is fetched once). */
const fetching = new Map<string, Promise<string | null>>()

/**
 * A combatant's portrait, fetched into the scene's images (they're saved with the scene, and
 * sent to the table): its image key, or null if there's none or it can't be read.
 */
export function portraitImage(url: string): Promise<string | null> {
  if (!url) return Promise.resolve(null)
  const key = portraitKeyOf(url)
  if (useGm.getState().objectImages[key]) return Promise.resolve(key)
  let p = fetching.get(url)
  if (!p) {
    p = (async () => {
      try {
        const response = await fetch(url)
        if (!response.ok) return null
        const image = await response.blob()
        const bitmap = await createImageBitmap(image)
        useGm.getState().setObjectImage(key, { image, width: bitmap.width, height: bitmap.height })
        bitmap.close()
        return key
      } catch {
        return null
      } finally {
        fetching.delete(url)
      }
    })()
    fetching.set(url, p)
  }
  return p
}

/** Everyone's portraits in, for the players' order of initiative. */
export function loadPortraits(summary: CombatSummary | null | undefined) {
  for (const c of summary?.combatants ?? []) if (c.portrait) void portraitImage(c.portrait)
}

/** Who "Place all" puts on the map: everyone but the players (their minis are on the table). */
export const placeable = (c: { side: string; vtt: unknown }) => c.side === 'npc' || !!c.vtt

/** The drag data of the "Place all" coin. */
export const PLACE_ALL = '*'

/** Put the tokens of everyone not on this floor yet on the map, in a block around p. */
export async function placeAllAt(at: Point) {
  const gm = useGm.getState()
  const placed = new Set((gm.scene.characters ?? []).map((t) => t.ref))
  const todo = (gm.combat?.summary?.combatants ?? []).filter((c) => placeable(c) && !placed.has(c.id))
  const portraits = await Promise.all(todo.map((c) => portraitImage(c.portrait)))
  useGm.getState().placeCombatants(
    todo.map((c, i) => ({ id: c.id, portrait: portraits[i] })),
    at,
  )
}

/** Put a combatant's token on the map at p (or move the one already there). */
export async function placeCombatantAt(id: string, at: Point) {
  const c = useGm.getState().combat?.summary?.combatants.find((x) => x.id === id)
  if (!c) return
  const portrait = await portraitImage(c.portrait)
  useGm.getState().placeCombatant(id, at, portrait)
}
