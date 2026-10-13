import { seenTokens } from '../shared/characters'
import { orderFor, orderPlacement, portraitKeyOf, type OrderStrip } from '../shared/combat'
import { tableState, type GmStore } from './store'

/** The last order worked out, and what it was worked out from (sight is costly to work out). */
let memo: { inputs: unknown[]; strip: OrderStrip | null } | null = null

/**
 * The order of initiative the table shows (null: none). Players see who is in the fight, in
 * order, and whose turn it is; not the tracker's reinforcements waiting to join, and not an
 * enemy whose token is on the table's floor but out of their sight.
 */
export function tableOrder(s: GmStore): OrderStrip | null {
  const combat = s.combat
  if (!combat?.showOrder || !combat.summary) return null
  const scene = tableState(s).scene
  const inputs = [
    combat,
    scene.characters,
    scene.lights,
    scene.walls,
    scene.fog.mode,
    scene.darkness,
    scene.hiddenAreas,
    scene.hiddenEnabled,
    scene.grid,
    s.objectImages,
  ]
  if (memo && inputs.every((v, i) => v === memo!.inputs[i])) return memo.strip
  const key = (url: string) => {
    const k = portraitKeyOf(url)
    return s.objectImages[k] ? k : null
  }
  const strip = orderFor(combat.summary, scene.characters ?? [], seenTokens(scene), key, orderPlacement(combat))
  memo = { inputs, strip }
  return strip
}
