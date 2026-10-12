import { clipsNeeded, type MapSound, type SoundClips } from './sound'
import type { Scene } from './types'

/** The clips a scene's sounds use (all floors' map sounds, the mixer's, doors'), with layers. */
export function usedClips(
  scene: Pick<Scene, 'globalSounds' | 'doorSounds' | 'walls'>,
  levelSounds: MapSound[][],
  clips: SoundClips,
): Set<string> {
  const keys = [
    ...levelSounds.flat().map((x) => x.clip),
    ...(scene.globalSounds ?? []).map((x) => x.clip),
    scene.doorSounds?.open,
    scene.doorSounds?.close,
    ...scene.walls.flatMap((w) => [w.door?.sounds?.open, w.door?.sounds?.close]),
  ].filter((k): k is string => !!k)
  return new Set(keys.flatMap((k) => clipsNeeded(k, clips)))
}
