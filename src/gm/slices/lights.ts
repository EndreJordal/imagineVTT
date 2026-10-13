/** Lights and vision tokens: placing, changing, moving and selecting them. */
import type { StateCreator } from 'zustand'
import { createLight, type Light, type LightKind } from '../../shared/lights'
import type { Point } from '../../shared/types'
import { moveCrossesWall, wallSegments } from '../../shared/visibility'
import { LIGHT_PRESETS } from '../../shared/lights'
import { nextName } from '../../shared/names'
import type { GmStore } from '../store'
import { selectOnly, SINGLES_OFF } from './shared'

export interface LightsSlice {
  /** Lights whose tokens are selected in the GM view (GM-only, not sent to the table). */
  selectedLightIds: string[]
  /** Add a light at a scene position and select it. */
  addLight(kind: LightKind, at: Point): void
  updateLight(id: string, patch: Partial<Light>): void
  /** Change several lights; a function patch can tailor the change to each light. */
  updateLights(ids: string[], patch: Partial<Light> | ((light: Light) => Partial<Light>)): void
  /**
   * Move lights. With `safe`, vision safety applies: if a vision token would cross a wall,
   * nothing moves and false is returned.
   */
  moveLights(ids: string[], dx: number, dy: number, safe?: boolean): boolean
  removeLights(ids: string[]): void
  /** Select just this light (or nothing at all). */
  selectLight(id: string | null): void
  /** Add a light to the selection, or take it out if it's already in. */
  toggleLightSelected(id: string): void
}

export const lightsSlice: StateCreator<GmStore, [], [], LightsSlice> = (set, get) => ({
  selectedLightIds: [],
  addLight: (kind, at) =>
    set((s) => {
      const light = createLight(kind, at.x, at.y, crypto.randomUUID())
      light.name = nextName(LIGHT_PRESETS[kind].label, s.scene.lights.map((l) => l.name))
      return {
        scene: { ...s.scene, lights: [...s.scene.lights, light] },
        ...selectOnly({ selectedLightIds: [light.id] }),
      }
    }),
  updateLight: (id, patch) =>
    set((s) => ({
      scene: { ...s.scene, lights: s.scene.lights.map((l) => (l.id === id ? { ...l, ...patch } : l)) },
    })),
  updateLights: (ids, patch) =>
    set((s) => {
      const chosen = new Set(ids)
      const lights = s.scene.lights.map((l) =>
        chosen.has(l.id) ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l,
      )
      return { scene: { ...s.scene, lights } }
    }),
  moveLights: (ids, dx, dy, safe = false) => {
    const s = get()
    const chosen = new Set(ids)
    if (safe && s.scene.fog.safety && s.scene.fog.mode !== 'off') {
      const segments = wallSegments(s.scene.walls)
      const crossing = s.scene.lights.some(
        (l) => chosen.has(l.id) && l.vision && moveCrossesWall(l, { x: l.x + dx, y: l.y + dy }, segments),
      )
      if (crossing) {
        s.notify('VISION SAFETY — a vision token tried to cross a wall and was dropped. Hold Alt to move through walls.')
        return false
      }
    }
    const lights = s.scene.lights.map((l) => (chosen.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l))
    set({ scene: { ...s.scene, lights } })
    return true
  },
  removeLights: (ids) =>
    set((s) => {
      const gone = new Set(ids)
      return {
        scene: { ...s.scene, lights: s.scene.lights.filter((l) => !gone.has(l.id)) },
        selectedLightIds: s.selectedLightIds.filter((id) => !gone.has(id)),
      }
    }),
  selectLight: (id) =>
    set(selectOnly({ selectedLightIds: id ? [id] : [] })),
  toggleLightSelected: (id) =>
    set((s) => ({
      selectedLightIds: s.selectedLightIds.includes(id)
        ? s.selectedLightIds.filter((x) => x !== id)
        : [...s.selectedLightIds, id],
      ...SINGLES_OFF,
    })),
})
