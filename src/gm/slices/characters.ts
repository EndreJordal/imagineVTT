/** Character tokens: placing, configuring and moving them. */
import type { StateCreator } from 'zustand'
import { snapToken, type CharacterToken } from '../../shared/characters'
import { nextName } from '../../shared/names'
import type { Point } from '../../shared/types'
import type { GmStore } from '../store'

/** What new tokens look like (the sidebar's choice; the GM's, not the scene's). */
export type CharacterLook = Pick<CharacterToken, 'border' | 'color' | 'size'>

export interface CharactersSlice {
  selectedCharacterId: string | null
  selectCharacter(id: string | null): void
  newCharacterLook: CharacterLook
  setNewCharacterLook(patch: Partial<CharacterLook>): void
  /** Place a token (it becomes the selection). */
  addCharacter(at: Point): void
  updateCharacter(id: string, patch: Partial<Omit<CharacterToken, 'id'>>): void
  /** Move a token to p (onto the squares, if it snaps). */
  moveCharacter(id: string, p: Point): void
  /** Move a token by whole squares (arrow keys); one that doesn't snap moves a fraction. */
  nudgeCharacter(id: string, dx: number, dy: number, fine: boolean): void
  removeCharacter(id: string): void
  setCharacterSlide(seconds: number): void
}

const OTHERS_OFF = {
  selectedLightIds: [],
  selectedWallPoints: [],
  selectedObjectIds: [],
  selectedHiddenId: null,
  selectedDoorId: null,
  selectedSoundId: null,
} satisfies Partial<GmStore>

export const charactersSlice: StateCreator<GmStore, [], [], CharactersSlice> = (set) => ({
  selectedCharacterId: null,
  selectCharacter: (selectedCharacterId) => set({ selectedCharacterId, ...OTHERS_OFF }),
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
      return { scene: { ...s.scene, characters: [...tokens, token] }, selectedCharacterId: token.id, ...OTHERS_OFF }
    }),
  updateCharacter: (id, patch) =>
    set((s) => ({
      scene: {
        ...s.scene,
        characters: (s.scene.characters ?? []).map((t) => {
          if (t.id !== id) return t
          const next = { ...t, ...patch }
          // A new size (or snapping switched on) settles it onto the squares.
          const resnap = next.snap && (patch.size !== undefined || patch.snap === true)
          return resnap ? { ...next, ...snapToken(next, next.size, s.scene.grid) } : next
        }),
      },
    })),
  moveCharacter: (id, p) =>
    set((s) => ({
      scene: {
        ...s.scene,
        characters: (s.scene.characters ?? []).map((t) =>
          t.id === id ? { ...t, ...(t.snap ? snapToken(p, t.size, s.scene.grid) : { x: p.x, y: p.y }) } : t,
        ),
      },
    })),
  nudgeCharacter: (id, dx, dy, fine) =>
    set((s) => {
      const t = (s.scene.characters ?? []).find((x) => x.id === id)
      if (!t) return s
      const step = s.scene.grid.size * (t.snap ? 1 : fine ? 0.5 : 0.1)
      const to = { x: t.x + dx * step, y: t.y + dy * step }
      const p = t.snap ? snapToken(to, t.size, s.scene.grid) : to
      return {
        scene: { ...s.scene, characters: (s.scene.characters ?? []).map((x) => (x.id === id ? { ...x, ...p } : x)) },
      }
    }),
  removeCharacter: (id) =>
    set((s) => ({
      scene: { ...s.scene, characters: (s.scene.characters ?? []).filter((t) => t.id !== id) },
      selectedCharacterId: s.selectedCharacterId === id ? null : s.selectedCharacterId,
    })),
  setCharacterSlide: (characterSlide) => set((s) => ({ scene: { ...s.scene, characterSlide } })),
})
