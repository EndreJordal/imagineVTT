import { sceneBounds } from '../shared/geometry'
import { activeWater, waterHearing } from '../shared/water'
import { openedDoors } from '../shared/doors'
import { hearing, DEFAULT_DOOR_SOUNDS, type MapSound } from '../shared/sound'
import type { Point, Scene } from '../shared/types'
import type { Wall } from '../shared/visibility'
import { player, type LoopHandle, type OnceHandle } from './audio'
import { tableState, useGm, type GmStore } from './store'

/**
 * What plays when: loops on the table's floor (map sounds, heard by the party within range)
 * and the mixer's, kept running at the right volume; sounds that play as the party comes
 * into range; doors opening and closing. Sounds are the table's: the floor it shows.
 */

/** Who hears map sounds and water: the vision tokens (none: nobody; global sounds are for that). */
function listeners(scene: Scene): Point[] {
  return scene.lights.filter((l) => l.vision)
}

/** The doors closed between two versions of the walls. */
function closedDoors(before: Wall[], after: Wall[]): Wall[] {
  if (before === after) return []
  const wasOpen = new Map(before.filter((w) => w.door).map((w) => [w.id, w.door!.open]))
  return after.filter((w) => w.door && !w.door.open && wasOpen.get(w.id) === true)
}

/** Sounds playing once, by the map or mixer sound playing them: cut short when it goes. */
const playing = new Map<string, OnceHandle[]>()

function playFor(id: string, handle: OnceHandle) {
  playing.set(id, [...(playing.get(id) ?? []).filter((h) => !h.done), handle])
}

/** Cut short what's playing for sounds no longer there (or switched off). */
function stopGone(keep: Set<string>) {
  for (const [id, handles] of playing) {
    if (keep.has(id)) continue
    for (const h of handles) h.stop()
    playing.delete(id)
  }
}

export function startSoundController(): () => void {
  const loops = new Map<string, { key: string; volume: number; handle: LoopHandle }>()

  const update = (s: GmStore, prev: GmStore | null) => {
    if (!prev || s.masterVolume !== prev.masterVolume) player.setMaster(s.masterVolume)
    if (!prev || s.audioOutput !== prev.audioOutput) void player.setOutput(s.audioOutput)
    const relevant =
      !prev ||
      s.scene !== prev.scene ||
      s.levels !== prev.levels ||
      s.tableLevelId !== prev.tableLevelId ||
      s.soundClips !== prev.soundClips
    if (!relevant) return
    const table = tableState(s).scene
    const ears = listeners(table)
    const grid = table.grid.size

    // Removed or disabled sounds go quiet at once, even mid-play.
    stopGone(
      new Set([
        ...(table.sounds ?? []).filter((x) => x.enabled).map((x) => x.id),
        ...(s.scene.sounds ?? []).filter((x) => x.enabled).map((x) => x.id),
        ...(s.scene.globalSounds ?? []).map((x) => x.id),
        ...activeWater(table.waterAreas).filter((w) => w.sound).map((w) => `water:${w.id}`),
      ]),
    )

    // Loops: what should be playing, and how loud.
    const wanted = new Map<string, { key: string; volume: number }>()
    for (const sound of table.sounds ?? []) {
      if (sound.enabled && sound.loop && s.soundClips[sound.clip]) {
        wanted.set(sound.id, { key: sound.clip, volume: sound.volume * hearing(sound, ears, grid) })
      }
    }
    const bounds = sceneBounds(table)
    for (const w of activeWater(table.waterAreas)) {
      if (w.sound && s.soundClips[w.sound.clip]) {
        wanted.set(`water:${w.id}`, { key: w.sound.clip, volume: w.sound.volume * waterHearing(w, bounds, ears, grid) })
      }
    }
    for (const g of s.scene.globalSounds ?? []) {
      if (g.loop && g.playing && s.soundClips[g.clip]) wanted.set(g.id, { key: g.clip, volume: g.volume })
    }
    for (const [id, l] of loops) {
      const want = wanted.get(id)
      if (!want || want.key !== l.key) {
        l.handle.stop()
        loops.delete(id)
      }
    }
    for (const [id, want] of wanted) {
      const l = loops.get(id)
      if (!l) loops.set(id, { ...want, handle: player.loop(s.soundClips, want.key, want.volume) })
      else if (Math.abs(l.volume - want.volume) > 0.005) {
        l.handle.setVolume(want.volume)
        l.volume = want.volume
      }
    }
    if (!prev) return

    // The party coming into range of a sound that plays then (once, until re-armed). Kept to
    // the floor the GM is on, which is the table's in play.
    if (s.levelId === s.tableLevelId && prev.levelId === prev.tableLevelId && s.scene.lights !== prev.scene.lights) {
      const before = listeners(prev.scene)
      const fired: MapSound[] = []
      for (const sound of table.sounds ?? []) {
        if (sound.loop || !sound.enabled || sound.spent || sound.trigger === 'manual') continue
        const now = hearing(sound, ears, grid)
        if (now > 0 && hearing(sound, before, grid) === 0) {
          playFor(sound.id, player.playOnce(s.soundClips, sound.clip, sound.volume * now))
          fired.push(sound)
        }
      }
      for (const sound of fired) useGm.getState().updateSound(sound.id, { spent: true })
    }

    // Doors on the table's floor opening and closing.
    const prevTable = tableState(prev).scene
    if (table.walls !== prevTable.walls && s.tableLevelId === prev.tableLevelId) {
      const all = table.doorSounds ?? DEFAULT_DOOR_SOUNDS
      for (const door of openedDoors(prevTable.walls, table.walls)) {
        const own = door.door?.sounds ?? all
        if (own.open) player.playOnce(s.soundClips, own.open, own.volume)
      }
      for (const door of closedDoors(prevTable.walls, table.walls)) {
        const own = door.door?.sounds ?? all
        if (own.close) player.playOnce(s.soundClips, own.close, own.volume)
      }
    }
  }

  update(useGm.getState(), null)
  const unsubscribe = useGm.subscribe((s, prev) => update(s, prev))
  // Browsers hold sound back until the page is clicked.
  const wake = () => player.wake()
  window.addEventListener('pointerdown', wake, true)
  window.addEventListener('keydown', wake, true)
  return () => {
    unsubscribe()
    window.removeEventListener('pointerdown', wake, true)
    window.removeEventListener('keydown', wake, true)
    for (const l of loops.values()) l.handle.stop()
    loops.clear()
    stopGone(new Set())
  }
}

/** Play a map sound now (its play button): at its own volume, wherever the party is. */
export function playMapSound(id: string) {
  const s = useGm.getState()
  const sound = tableState(s).scene.sounds?.find((x) => x.id === id) ?? s.scene.sounds?.find((x) => x.id === id)
  if (!sound) return
  if (sound.loop) s.updateSound(id, { enabled: !sound.enabled })
  else playFor(id, player.playOnce(s.soundClips, sound.clip, sound.volume))
}

/** Play a mixer sound now: a loop starts or stops; others play once. */
export function playGlobalSound(id: string) {
  const s = useGm.getState()
  const g = s.scene.globalSounds?.find((x) => x.id === id)
  if (!g) return
  if (g.loop) s.updateGlobal(id, { playing: !g.playing })
  else playFor(id, player.playOnce(s.soundClips, g.clip, g.volume))
}
