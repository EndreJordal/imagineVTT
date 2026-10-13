/** The map's resize square and padlock button (GM-only). */
import { Graphics } from 'pixi.js'
import type { MapInfo, Point } from '../shared/types'
import { SLACK_PX } from './canvasStyle'
import type { Target } from './canvasTypes'

const HANDLE_COLOR = 0x4da3ff
const LOCKED_COLOR = 0x8a8a94
/** Map resize handle half-size, in GM screen pixels (larger when locked, to fit a padlock). */
const HANDLE_PX = 7
const LOCKED_HANDLE_PX = 10
/** The padlock button beside the map's resize square: its half size (screen px) and locked colour. */
const LOCK_BUTTON_PX = 8
const LOCK_ON_COLOR = 0xffb020

/** Where the map's padlock button is: left of the resize square, on the map's bottom edge. */
function mapLockSpot(map: MapInfo, px: number) {
  const handle = map.lockToGrid ? LOCKED_HANDLE_PX : HANDLE_PX
  return { x: map.x + map.width - (handle + LOCK_BUTTON_PX + 4) * px, y: map.y + map.height }
}

export class MapHandle {
  readonly g = new Graphics()

  draw(map: MapInfo | null | undefined, px: number) {
    const g = this.g.clear()
    if (!map) return
    const locked = !!map.lockToGrid
    // Locked in place or to the grid: the resize square is greyed out (it does nothing).
    const color = locked || map.locked ? LOCKED_COLOR : HANDLE_COLOR
    const r = (locked ? LOCKED_HANDLE_PX : HANDLE_PX) * px
    const cx = map.x + map.width
    const cy = map.y + map.height
    g.rect(map.x, map.y, map.width, map.height).stroke({ width: 1.5 * px, color, alpha: 0.6 })
    g.rect(cx - r, cy - r, 2 * r, 2 * r)
      .fill(color)
      .stroke({ width: 1.5 * px, color: 0x000000 })
    // The padlock beside it: click to lock the map's position, or unlock it.
    const lock = mapLockSpot(map, px)
    const lr = LOCK_BUTTON_PX * px
    const held = !!map.locked
    g.roundRect(lock.x - lr, lock.y - lr, 2 * lr, 2 * lr, 2 * px)
      .fill(held ? LOCK_ON_COLOR : LOCKED_COLOR)
      .stroke({ width: 1.5 * px, color: 0x000000 })
    {
      const ink = 0x1d1d22
      // Shut: the shackle sits down on the body; open: lifted and swung to one side.
      const sx = held ? lock.x : lock.x + 2.4 * px
      const sy = lock.y - (held ? 0.5 : 2.2) * px
      g.moveTo(sx - 2.8 * px, sy)
        .arc(sx, sy, 2.8 * px, Math.PI, 0)
        .stroke({ width: 1.5 * px, color: ink })
      if (held) g.moveTo(sx - 2.8 * px, sy).lineTo(sx - 2.8 * px, lock.y + 0.5 * px).moveTo(sx + 2.8 * px, sy).lineTo(sx + 2.8 * px, lock.y + 0.5 * px).stroke({ width: 1.5 * px, color: ink })
      else g.moveTo(sx - 2.8 * px, sy).lineTo(sx - 2.8 * px, lock.y + 0.5 * px).stroke({ width: 1.5 * px, color: ink })
      g.roundRect(lock.x - 4.5 * px, lock.y - 0.5 * px, 9 * px, 6 * px, 1.1 * px).fill(ink)
    }
    if (locked) {
      // Padlock: shackle arc over a body, in dark ink on the grey square.
      const ink = 0x1d1d22
      // moveTo first: arc() otherwise joins from the pen's last point (the map's corner).
      const shackle = 3.2 * px
      g.moveTo(cx - shackle, cy - 1 * px)
        .arc(cx, cy - 1 * px, shackle, Math.PI, 0)
        .stroke({ width: 1.6 * px, color: ink })
      g.roundRect(cx - 5 * px, cy - 1 * px, 10 * px, 7 * px, 1.2 * px).fill(ink)
    }
  }

  /** The resize square ('locked' when it does nothing) or the padlock button, at p. */
  hit(p: Point, map: MapInfo, px: number): Target {
    const r = ((map.lockToGrid ? LOCKED_HANDLE_PX : HANDLE_PX) + SLACK_PX) * px
    const cx = map.x + map.width
    const cy = map.y + map.height
    if (Math.abs(p.x - cx) <= r && Math.abs(p.y - cy) <= r) {
      return { kind: map.lockToGrid || map.locked ? 'locked' : 'resize' }
    }
    const lock = mapLockSpot(map, px)
    const rl = (LOCK_BUTTON_PX + SLACK_PX) * px
    if (Math.abs(p.x - lock.x) <= rl && Math.abs(p.y - lock.y) <= rl) return { kind: 'mapLock' }
    return null
  }
}
