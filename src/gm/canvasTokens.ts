/** GM-only tokens (an icon in a ring): the pool they're kept in, and hidden areas' and sounds'. */
import { Container, Graphics, Sprite } from 'pixi.js'
import { sceneBounds } from '../shared/geometry'
import { activeAreas, areaCentre } from '../shared/hidden'
import type { MapSound } from '../shared/sound'
import type { Point, Scene } from '../shared/types'
import { iconTexture, type CanvasIcon } from './canvasIcons'
import { HIDDEN_COLOR, TOKEN_PX, WATER_COLOR } from './canvasStyle'
import { waterCentre } from '../shared/water'
import type { Target, Token, View } from './canvasTypes'

/** Size of a token's icon, in GM screen px. */
export const ICON_PX = 18
/** Sounds' tokens and ranges. */
const SOUND_COLOR = 0x4dd2c0
/** A sound's play button: its radius, and how far right of the token it sits (GM screen px). */
const PLAY_PX = 8
const PLAY_OFFSET_PX = 24

/** Tokens by id, made when first needed and dropped when their thing is gone. */
export class TokenPool<T extends Token> {
  readonly layer = new Container()
  private tokens = new Map<string, T>()
  private make: () => T

  constructor(make: () => T) {
    this.make = make
  }

  /** Drop the tokens whose ids aren't in `ids`. */
  keep(ids: Iterable<string>) {
    const kept = new Set(ids)
    for (const [id, t] of this.tokens) {
      if (kept.has(id)) continue
      t.root.destroy({ children: true })
      this.tokens.delete(id)
    }
  }

  get(id: string): T {
    let t = this.tokens.get(id)
    if (!t) {
      t = this.make()
      this.layer.addChild(t.root)
      this.tokens.set(id, t)
    }
    return t
  }
}

export function iconToken(): Token {
  const t = { root: new Container(), ring: new Graphics(), icon: new Sprite({ anchor: 0.5 }) }
  t.root.addChild(t.ring, t.icon)
  return t
}

/** Place a token at p, the same size on screen, with its icon and a ring in `color`. */
export function drawToken(t: Token, p: Point, px: number, icon: CanvasIcon, color: string | number, selected: boolean) {
  t.root.position.set(p.x, p.y)
  t.root.scale.set(px)
  t.icon.texture = iconTexture(icon)
  t.icon.setSize(ICON_PX)
  t.ring.clear().circle(0, 0, TOKEN_PX).fill({ color: 0x1d1d22, alpha: 0.85 }).stroke({ width: 2.5, color })
  if (selected) t.ring.circle(0, 0, TOKEN_PX + 3.5).stroke({ width: 2, color: 0xffffff })
}

/** Whether p is on a token at c. */
export const onToken = (p: Point, c: Point, px: number) => Math.hypot(p.x - c.x, p.y - c.y) <= (TOKEN_PX + 2) * px

/** Hidden areas' tokens: the crossed-out eye, at each area's middle. */
export class HiddenTokens {
  private pool = new TokenPool(iconToken)
  readonly layer = this.pool.layer

  draw({ scene, ui, px }: View) {
    const areas = scene.hiddenAreas ?? []
    this.pool.keep(areas.map((a) => a.id))
    const bounds = sceneBounds(scene)
    const active = new Set(activeAreas(scene))
    for (const area of areas) {
      const t = this.pool.get(area.id)
      drawToken(t, areaCentre(area, bounds), px, 'hide', HIDDEN_COLOR, area.id === ui.selectedHiddenId)
      t.root.alpha = active.has(area) ? 1 : 0.4 // switched off: kept, not drawn
    }
  }

  hit(p: Point, scene: Scene, px: number): Target {
    const bounds = sceneBounds(scene)
    const area = (scene.hiddenAreas ?? []).findLast((a) => onToken(p, areaCentre(a, bounds), px))
    return area ? { kind: 'hidden', id: area.id } : null
  }
}

/** Water areas' tokens: a drop at each area's middle (switched off: faint). */
export class WaterTokens {
  private pool = new TokenPool(iconToken)
  readonly layer = this.pool.layer

  draw({ scene, ui, px }: View) {
    const areas = scene.waterAreas ?? []
    this.pool.keep(areas.map((a) => a.id))
    const bounds = sceneBounds(scene)
    for (const area of areas) {
      const t = this.pool.get(area.id)
      drawToken(t, waterCentre(area, bounds), px, 'water', WATER_COLOR, ui.selectedWaterIds.includes(area.id))
      t.root.alpha = area.active === false ? 0.4 : 1
    }
  }

  hit(p: Point, scene: Scene, px: number): Target {
    const bounds = sceneBounds(scene)
    const area = (scene.waterAreas ?? []).findLast((a) => onToken(p, waterCentre(a, bounds), px))
    return area ? { kind: 'water', id: area.id } : null
  }
}

/** Sounds' tokens: a speaker with a play button beside it, and the selected one's range. */
export class SoundTokens {
  private pool = new TokenPool(() => {
    const t = iconToken()
    const play = new Graphics()
    t.root.addChild(play)
    return { ...t, play }
  })
  readonly layer = this.pool.layer
  readonly range = new Graphics()

  draw({ scene, ui, px }: View) {
    const sounds = scene.sounds ?? []
    this.pool.keep(sounds.map((x) => x.id))
    const range = this.range.clear()
    for (const sound of sounds) {
      const t = this.pool.get(sound.id)
      const selected = sound.id === ui.selectedSoundId
      drawToken(t, sound, px, 'sound', SOUND_COLOR, selected)
      t.root.alpha = sound.enabled ? 1 : 0.45
      if (selected) range.circle(sound.x, sound.y, sound.range * scene.grid.size).stroke({ width: 1.5 * px, color: SOUND_COLOR, alpha: 0.6 })
      // The play button: a loop's switches it on and off (a square while it plays).
      const b = PLAY_OFFSET_PX
      t.play.clear().circle(b, 0, PLAY_PX).fill({ color: SOUND_COLOR }).stroke({ width: 1.5, color: 0x000000, alpha: 0.6 })
      if (sound.loop && sound.enabled) t.play.rect(b - 3, -3, 6, 6).fill(0x1d1d22)
      else t.play.poly([b - 2.5, -4, b + 4, 0, b - 2.5, 4]).fill(0x1d1d22)
    }
  }

  hit(p: Point, sounds: MapSound[], px: number): Target {
    for (const sound of sounds.toReversed()) {
      const play = { x: sound.x + PLAY_OFFSET_PX * px, y: sound.y }
      if (Math.hypot(p.x - play.x, p.y - play.y) <= (PLAY_PX + 2) * px) return { kind: 'soundPlay', id: sound.id }
      if (onToken(p, sound, px)) return { kind: 'sound', id: sound.id }
    }
    return null
  }
}
