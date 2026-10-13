/** Sound: clips, sounds on the map, the mixer's global sounds, door sounds, output and master. */
import type { StateCreator } from 'zustand'
import { nextName } from '../../shared/names'
import {
  type DoorSounds,
  type GlobalSound,
  type MapSound,
  type SoundClips,
} from '../../shared/sound'
import type { Point } from '../../shared/types'
import type { GmStore } from '../store'

export interface AudioSlice {
  /** The audio of the sounds used, by clip key; kept with the scene. */
  soundClips: SoundClips
  addSoundClips(clips: SoundClips): void
  /** The map sound whose token is selected (GM-only). */
  selectedSoundId: string | null
  selectSound(id: string | null): void
  /** Place a sound on the map (it becomes the selection). */
  addSound(clip: string, name: string, at: Point): void
  updateSound(id: string, patch: Partial<Omit<MapSound, 'id'>>): void
  removeSound(id: string): void
  /** Take a map sound off the map, into the mixer. */
  makeGlobal(id: string): void
  updateGlobal(id: string, patch: Partial<Omit<GlobalSound, 'id'>>): void
  removeGlobal(id: string): void
  /** The sounds for all doors without their own. */
  setDoorSounds(patch: Partial<DoorSounds>): void
  /** A door's own sounds, or (undefined) the ones for all doors. */
  setDoorOwnSounds(id: string, sounds: DoorSounds | undefined): void
  /** Master volume, 0..1 (a GM preference, kept between sessions). */
  masterVolume: number
  setMasterVolume(v: number): void
  /** Where game sound plays: an output device id ('' = the system's default). */
  audioOutput: string
  setAudioOutput(id: string): void
}

export const audioSlice: StateCreator<GmStore, [], [], AudioSlice> = (set) => ({
  soundClips: {},
  addSoundClips: (clips) => set((s) => ({ soundClips: { ...s.soundClips, ...clips } })),
  selectedSoundId: null,
  selectSound: (selectedSoundId) =>
    set({
      selectedSoundId,
      selectedLightIds: [],
      selectedObjectIds: [],
      selectedWallPoints: [],
      selectedHiddenId: null,
      selectedDoorId: null,
      selectedCharacterId: null,
    }),
  addSound: (clip, name, at) =>
    set((s) => {
      const sounds = s.scene.sounds ?? []
      const loops = !!s.soundClips[clip]?.layers // ambiences loop
      const sound: MapSound = {
        id: crypto.randomUUID(),
        name: nextName(name, sounds.map((x) => x.name), true),
        clip,
        x: at.x,
        y: at.y,
        volume: 0.8,
        range: 6,
        enabled: true,
        loop: loops,
        trigger: 'manual',
      }
      return {
        scene: { ...s.scene, sounds: [...sounds, sound] },
        selectedSoundId: sound.id,
        selectedLightIds: [],
        selectedObjectIds: [],
        selectedHiddenId: null,
      }
    }),
  updateSound: (id, patch) =>
    set((s) => ({ scene: { ...s.scene, sounds: (s.scene.sounds ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) } })),
  removeSound: (id) =>
    set((s) => ({
      scene: { ...s.scene, sounds: (s.scene.sounds ?? []).filter((x) => x.id !== id) },
      selectedSoundId: s.selectedSoundId === id ? null : s.selectedSoundId,
    })),
  makeGlobal: (id) =>
    set((s) => {
      const sound = (s.scene.sounds ?? []).find((x) => x.id === id)
      if (!sound) return s
      const global: GlobalSound = {
        id: sound.id,
        name: sound.name,
        clip: sound.clip,
        volume: sound.volume,
        loop: sound.loop,
        playing: sound.loop && sound.enabled,
      }
      return {
        scene: {
          ...s.scene,
          sounds: (s.scene.sounds ?? []).filter((x) => x.id !== id),
          globalSounds: [...(s.scene.globalSounds ?? []), global],
        },
        selectedSoundId: null,
      }
    }),
  updateGlobal: (id, patch) =>
    set((s) => ({
      scene: { ...s.scene, globalSounds: (s.scene.globalSounds ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) },
    })),
  removeGlobal: (id) =>
    set((s) => ({ scene: { ...s.scene, globalSounds: (s.scene.globalSounds ?? []).filter((x) => x.id !== id) } })),
  setDoorSounds: (patch) =>
    set((s) => ({
      scene: { ...s.scene, doorSounds: { ...(s.scene.doorSounds ?? { open: null, close: null, volume: 0.8 }), ...patch } },
    })),
  setDoorOwnSounds: (id, sounds) =>
    set((s) => ({
      scene: {
        ...s.scene,
        walls: s.scene.walls.map((w) => {
          if (w.id !== id || !w.door) return w
          const { sounds: _old, ...door } = w.door
          void _old
          return { ...w, door: sounds ? { ...door, sounds } : door }
        }),
      },
    })),
  masterVolume: 0.8,
  setMasterVolume: (masterVolume) => set({ masterVolume }),
  audioOutput: '',
  setAudioOutput: (audioOutput) => set({ audioOutput }),
})
