import { seenTokens, tokenDiameter } from '../shared/characters'
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
    s.turnMove,
  ]
  if (memo && inputs.every((v, i) => v === memo!.inputs[i])) return memo.strip
  const key = (url: string) => {
    const k = portraitKeyOf(url)
    return s.objectImages[k] ? k : null
  }
  const seen = seenTokens(scene)
  const order = orderFor(combat.summary, scene.characters ?? [], seen, key, orderPlacement(combat))
  // The acting combatant: how far it has moved this turn, and (if the players see its token)
  // a ring where it started.
  const turn = s.turnMove
  const token = turn && scene.characters?.find((t) => t.ref === turn.ref)
  const strip: OrderStrip = turn
    ? {
        ...order,
        entries: order.entries.map((e) => (e.id === turn.ref ? { ...e, moved: Math.round(turn.squares) } : e)),
        ...(combat.showStart !== false &&
          token &&
          seen.has(token.id) && { start: { ...turn.start, r: tokenDiameter(token, scene) / 2 } }),
      }
    : order
  memo = { inputs, strip }
  return strip
}
