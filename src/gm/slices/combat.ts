/** The fight linked to the scene (from the combat tracker), and its combatants' tokens. */
import type { StateCreator } from 'zustand'
import { snapToken, type CharacterToken } from '../../shared/characters'
import { combatantLook, isDown, type Combatant, type CombatSave, type CombatSummary, type TurnMove } from '../../shared/combat'
import type { GridSettings, Point } from '../../shared/types'
import type { GmStore } from '../store'
import { selectOnly } from './shared'

export interface CombatSlice {
  /** The fight linked to the scene; kept with the scene, so it can be resumed. */
  combat: CombatSave | null
  setCombat(combat: CombatSave | null): void
  /** When the tracker was last heard from, and which fight it holds (this session only). */
  tracker: { seen: number; linkId: string | null }
  trackerHeard(linkId: string | null): void
  /** The tracker's report: kept (true) only if it's this scene's fight. */
  receiveTrackerState(linkId: string, summary: CombatSummary, snapshot: unknown): boolean
  setCombatOrder(patch: Partial<Pick<CombatSave, 'showOrder' | 'edge' | 'facing' | 'both' | 'showStart'>>): void
  /** How far the acting combatant's token has moved on its turn (undone with its moves). */
  turnMove: TurnMove | null
  /** Place a combatant's token at p on the floor being viewed (or move the one there). */
  placeCombatant(id: string, at: Point, portrait: string | null): void
  /** Place the tokens of these combatants (those not on this floor yet) in a block around p. */
  placeCombatants(placing: { id: string; portrait: string | null }[], at: Point): void
  /** Take every token of the linked fight off every floor (starting the fight again). */
  clearCombatTokens(): void
}

/** Tokens following their combatants: name, whether they're out of the fight, and conditions. */
function follow(tokens: CharacterToken[] | undefined, byId: Map<string, Combatant>): CharacterToken[] | undefined {
  if (!tokens?.some((t) => t.ref && byId.has(t.ref))) return tokens
  let changed = false
  const out = tokens.map((t) => {
    const c = t.ref ? byId.get(t.ref) : undefined
    if (!c) return t
    const down = isDown(c)
    const conditions = c.conditions?.length ? c.conditions : undefined
    const same = JSON.stringify(t.conditions ?? null) === JSON.stringify(conditions ?? null)
    if (t.name === c.name && !!t.down === down && same) return t
    changed = true
    return { ...t, name: c.name, down, conditions }
  })
  return changed ? out : tokens
}

/** A new token for a combatant at p: its encounter's look, hidden until the GM shows it. */
function tokenFor(c: Combatant, at: Point, portrait: string | null, grid: GridSettings): CharacterToken {
  const look = combatantLook(c)
  return {
    id: crypto.randomUUID(),
    name: c.name,
    ...look,
    ...snapToken(at, look.size, grid),
    ...(portrait && { portrait }),
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    // Hidden until the GM reveals it: placing a fight beforehand mustn't give it away.
    visible: false,
    snap: true,
    ref: c.id,
    ...(isDown(c) && { down: true }),
  }
}

export const combatSlice: StateCreator<GmStore, [], [], CombatSlice> = (set) => ({
  combat: null,
  setCombat: (combat) => set({ combat, turnMove: null }),
  turnMove: null,
  tracker: { seen: 0, linkId: null },
  trackerHeard: (linkId) => set({ tracker: { seen: Date.now(), linkId } }),
  receiveTrackerState: (linkId, summary, snapshot) => {
    let kept = false
    set((s) => {
      if (!s.combat || s.combat.linkId !== linkId) return s
      kept = true
      const byId = new Map(summary.combatants.map((c) => [c.id, c]))
      const characters = follow(s.scene.characters, byId)
      const levels = s.levels.map((l) => {
        if (l.id === s.levelId) return l
        const moved = follow(l.characters, byId)
        return moved === l.characters ? l : { ...l, characters: moved }
      })
      const tokensChanged = characters !== s.scene.characters || levels.some((l, i) => l !== s.levels[i])
      // Another turn: the count starts again.
      const turn = s.turnMove
      const sameTurn = turn && turn.ref === summary.activeId && turn.round === summary.round
      return {
        combat: { ...s.combat, summary, snapshot },
        ...(turn && !sameTurn && { turnMove: null }),
        tracker: { seen: Date.now(), linkId },
        ...(tokensChanged && { scene: { ...s.scene, characters }, levels }),
      }
    })
    return kept
  },
  setCombatOrder: (patch) => set((s) => (s.combat ? { combat: { ...s.combat, ...patch } } : s)),
  placeCombatant: (id, at, portrait) =>
    set((s) => {
      const c = s.combat?.summary?.combatants.find((x) => x.id === id)
      if (!c) return s
      const tokens = s.scene.characters ?? []
      const existing = tokens.find((t) => t.ref === id)
      if (existing) {
        const p = existing.snap ? snapToken(at, existing.size, s.scene.grid) : at
        return {
          scene: { ...s.scene, characters: tokens.map((t) => (t.id === existing.id ? { ...t, ...p } : t)) },
          ...selectOnly({ selectedCharacterIds: [existing.id] }),
        }
      }
      const token = tokenFor(c, at, portrait, s.scene.grid)
      return {
        scene: { ...s.scene, characters: [...tokens, token] },
        ...selectOnly({ selectedCharacterIds: [token.id] }),
      }
    }),
  placeCombatants: (placing, at) =>
    set((s) => {
      const tokens = s.scene.characters ?? []
      const byId = new Map(s.combat?.summary?.combatants.map((c) => [c.id, c]))
      const todo = placing.filter((p) => byId.has(p.id) && !tokens.some((t) => t.ref === p.id))
      if (!todo.length) return s
      // A block of them, as square as can be, centred on the drop; room for the biggest.
      const step = s.scene.grid.size * Math.max(...todo.map((p) => combatantLook(byId.get(p.id)!).size))
      const cols = Math.ceil(Math.sqrt(todo.length))
      const rows = Math.ceil(todo.length / cols)
      const added = todo.map((p, i) => {
        const where = {
          x: at.x + ((i % cols) - (cols - 1) / 2) * step,
          y: at.y + (Math.floor(i / cols) - (rows - 1) / 2) * step,
        }
        return tokenFor(byId.get(p.id)!, where, p.portrait, s.scene.grid)
      })
      return {
        scene: { ...s.scene, characters: [...tokens, ...added] },
        // All of them selected: dragged on together, or grouped.
        ...selectOnly({ selectedCharacterIds: added.map((t) => t.id) }),
      }
    }),
  clearCombatTokens: () =>
    set((s) => {
      const keep = (tokens: CharacterToken[] | undefined) => tokens?.filter((t) => !t.ref)
      return {
        scene: { ...s.scene, characters: keep(s.scene.characters) },
        levels: s.levels.map((l) => (l.id === s.levelId ? l : { ...l, characters: keep(l.characters) })),
        selectedCharacterIds: [],
      }
    }),
})
