/** Character tokens: placing, configuring, selecting and moving them. */
import type { StateCreator } from 'zustand'
import { snapToken, type CharacterToken } from '../../shared/characters'
import { turnBy } from '../../shared/handout'
import { nextName } from '../../shared/names'
import type { Point } from '../../shared/types'
import type { GmStore } from '../store'
import { selectOnly, SINGLES_OFF } from './shared'

/** What new tokens look like (the sidebar's choice; the GM's, not the scene's). */
export type CharacterLook = Pick<CharacterToken, 'border' | 'color' | 'size'>

export interface CharactersSlice {
  /** The selected tokens (one for its panel; several to move, group or change together). */
  selectedCharacterIds: string[]
  /** Select just this token (null: none). */
  selectCharacter(id: string | null): void
  /** These tokens (added to the selection, if `add`). */
  selectCharacters(ids: string[], add?: boolean): void
  /** A token in or out of the selection (Shift+click). */
  toggleCharacterSelected(id: string): void
  newCharacterLook: CharacterLook
  setNewCharacterLook(patch: Partial<CharacterLook>): void
  /** Place a token (it becomes the selection). */
  addCharacter(at: Point): void
  updateCharacter(id: string, patch: Partial<Omit<CharacterToken, 'id'>>): void
  /** The same change to several tokens. */
  updateCharacters(ids: string[], patch: Partial<Omit<CharacterToken, 'id'>>): void
  /** Move tokens together by (dx, dy), each settling onto the squares if it snaps. */
  moveCharacters(ids: string[], dx: number, dy: number): void
  /** Move tokens by whole squares (arrow keys); ones that don't snap move a fraction. */
  nudgeCharacters(ids: string[], dx: number, dy: number, fine: boolean): void
  removeCharacter(id: string): void
  removeCharacters(ids: string[]): void
  setCharacterSlide(seconds: number): void
  /** Turn every token (border, portrait and text) by quarter turns (clockwise). */
  turnCharacters(by: number): void
}

/** Where a token goes when moved to p: onto the squares, if it snaps. */
const settle = (t: CharacterToken, p: Point, grid: GmStore['scene']['grid']): Point =>
  t.snap ? snapToken(p, t.size, grid) : { x: p.x, y: p.y }

/** A change to the tokens whose ids are chosen (the scene's own list stays if none). */
function change(s: GmStore, ids: Iterable<string>, fn: (t: CharacterToken) => CharacterToken) {
  const chosen = new Set(ids)
  return { scene: { ...s.scene, characters: (s.scene.characters ?? []).map((t) => (chosen.has(t.id) ? fn(t) : t)) } }
}

/** A token with a patch applied: a new size (or snapping switched on) settles it onto the squares. */
function patched(t: CharacterToken, patch: Partial<CharacterToken>, grid: GmStore['scene']['grid']) {
  const next = { ...t, ...patch }
  const resnap = next.snap && (patch.size !== undefined || patch.snap === true)
  return resnap ? { ...next, ...snapToken(next, next.size, grid) } : next
}

export const charactersSlice: StateCreator<GmStore, [], [], CharactersSlice> = (set) => ({
  selectedCharacterIds: [],
  selectCharacter: (id) => set(selectOnly({ selectedCharacterIds: id ? [id] : [] })),
  selectCharacters: (ids, add = false) =>
    set((s) =>
      add
        ? { selectedCharacterIds: [...new Set([...s.selectedCharacterIds, ...ids])], ...SINGLES_OFF }
        : selectOnly({ selectedCharacterIds: ids }),
    ),
  toggleCharacterSelected: (id) =>
    set((s) => ({
      selectedCharacterIds: s.selectedCharacterIds.includes(id)
        ? s.selectedCharacterIds.filter((x) => x !== id)
        : [...s.selectedCharacterIds, id],
      ...SINGLES_OFF,
    })),
  newCharacterLook: { border: 'gold', color: '#b03a2e', size: 1 },
  setNewCharacterLook: (patch) => set((s) => ({ newCharacterLook: { ...s.newCharacterLook, ...patch } })),
  addCharacter: (at) =>
    set((s) => {
      const tokens = s.scene.characters ?? []
      const look = s.newCharacterLook
      const token: CharacterToken = {
        id: crypto.randomUUID(),
        name: nextName('Character', tokens.map((t) => t.name)),
        ...snapToken(at, look.size, s.scene.grid),
        ...look,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        visible: true,
        snap: true,
      }
      return { scene: { ...s.scene, characters: [...tokens, token] }, ...selectOnly({ selectedCharacterIds: [token.id] }) }
    }),
  updateCharacter: (id, patch) => set((s) => change(s, [id], (t) => patched(t, patch, s.scene.grid))),
  updateCharacters: (ids, patch) => set((s) => change(s, ids, (t) => patched(t, patch, s.scene.grid))),
  moveCharacters: (ids, dx, dy) =>
    set((s) => change(s, ids, (t) => ({ ...t, ...settle(t, { x: t.x + dx, y: t.y + dy }, s.scene.grid) }))),
  nudgeCharacters: (ids, dx, dy, fine) => set((s) => nudge(s, ids, dx, dy, fine)),
  removeCharacter: (id) =>
    set((s) => ({
      scene: { ...s.scene, characters: (s.scene.characters ?? []).filter((t) => t.id !== id) },
      selectedCharacterIds: s.selectedCharacterIds.filter((x) => x !== id),
    })),
  removeCharacters: (ids) =>
    set((s) => {
      const gone = new Set(ids)
      return {
        scene: { ...s.scene, characters: (s.scene.characters ?? []).filter((t) => !gone.has(t.id)) },
        selectedCharacterIds: s.selectedCharacterIds.filter((x) => !gone.has(x)),
      }
    }),
  setCharacterSlide: (characterSlide) => set((s) => ({ scene: { ...s.scene, characterSlide } })),
  turnCharacters: (by) =>
    set((s) => ({ scene: { ...s.scene, characterTurn: turnBy(s.scene.characterTurn ?? 0, by) } })),
})

/** Tokens moved by whole squares (a fraction of one if they don't snap: Shift for half). */
function nudge(s: GmStore, ids: string[], dx: number, dy: number, fine: boolean) {
  return change(s, ids, (t) => {
    const step = s.scene.grid.size * (t.snap ? 1 : fine ? 0.5 : 0.1)
    return { ...t, ...settle(t, { x: t.x + dx * step, y: t.y + dy * step }, s.scene.grid) }
  })
}
