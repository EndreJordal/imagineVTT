/** The selected objects' outline, corner handles to resize and a handle above to rotate. */
import { Graphics } from 'pixi.js'
import { objectCorners, type MapObject } from '../shared/mapObjects'
import type { Point } from '../shared/types'
import { SLACK_PX } from './canvasStyle'
import { resizeCursor, type Target } from './canvasTypes'

const OBJECT_COLOR = 0x4da3ff
/** Corner handles (half-size) and rotation handle (radius, distance out), GM px. */
const OBJECT_HANDLE_PX = 5
const ROTATE_HANDLE_PX = 6
const ROTATE_OUT_PX = 26

/** Where an object's rotation handle is: above its top edge, turning with it. */
function rotateHandle(o: MapObject, px: number): Point {
  const d = o.height / 2 + ROTATE_OUT_PX * px
  return { x: o.x + Math.sin(o.rotation) * d, y: o.y - Math.cos(o.rotation) * d }
}

export class ObjectHandles {
  readonly g = new Graphics()

  draw(selected: MapObject[], px: number) {
    const g = this.g.clear()
    for (const o of selected) {
      const corners = objectCorners(o)
      g.poly(corners).stroke({ width: 3 * px, color: 0x000000, alpha: 0.5 })
      g.poly(corners).stroke({ width: 1.5 * px, color: OBJECT_COLOR })
      const r = OBJECT_HANDLE_PX * px
      for (const c of corners) g.rect(c.x - r, c.y - r, 2 * r, 2 * r).fill(0xffffff).stroke({ width: 1.5 * px, color: OBJECT_COLOR })
      const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }
      const h = rotateHandle(o, px)
      g.moveTo(top.x, top.y).lineTo(h.x, h.y).stroke({ width: 1.5 * px, color: OBJECT_COLOR })
      g.circle(h.x, h.y, ROTATE_HANDLE_PX * px).fill(0xffffff).stroke({ width: 1.5 * px, color: OBJECT_COLOR })
    }
  }

  /** A selected object's rotation or corner handle at p. */
  hit(p: Point, selected: MapObject[], px: number): Target {
    for (const o of selected) {
      const h = rotateHandle(o, px)
      if (Math.hypot(p.x - h.x, p.y - h.y) <= (ROTATE_HANDLE_PX + SLACK_PX) * px) return { kind: 'objectRotate', id: o.id }
      for (const c of objectCorners(o)) {
        if (Math.hypot(p.x - c.x, p.y - c.y) <= (OBJECT_HANDLE_PX + SLACK_PX) * px) {
          return { kind: 'objectResize', id: o.id, cursor: resizeCursor(c.x - o.x, c.y - o.y) }
        }
      }
    }
    return null
  }
}
