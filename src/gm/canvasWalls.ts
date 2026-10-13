/**
 * Walls (GM-only: players only see their effect on sight) as red lines with dots at their
 * points, doors in green (faded when open) with an open/close button in the middle.
 */
import { Graphics } from 'pixi.js'
import { doorMiddle } from '../shared/doors'
import type { Point } from '../shared/types'
import type { Wall } from '../shared/visibility'
import { spotKey, uniquePositions, type WallPointRef } from '../shared/walls'
import { DOOR_COLOR, SLACK_PX, WALL_COLOR, WALL_DOT_PX, WALL_PX } from './canvasStyle'
import type { Target } from './canvasTypes'

/** A door's open/close button (in its middle), radius in GM screen px. */
const DOOR_BUTTON_PX = 10

export class WallsLayer {
  readonly g = new Graphics()
  private drawn: { walls: Wall[]; px: number; selected: WallPointRef[] } | null = null

  draw(walls: Wall[], px: number, selectedPoints: WallPointRef[]) {
    // Redrawn only when the walls, the zoom or the selection changed (maps can have thousands).
    const d = this.drawn
    if (d && d.walls === walls && d.px === px && d.selected === selectedPoints) return
    this.drawn = { walls, px, selected: selectedPoints }
    const g = this.g.clear()
    for (const wall of walls) {
      const color = wall.door ? DOOR_COLOR : WALL_COLOR
      const alpha = wall.door?.open ? 0.4 : 1
      g.poly(wall.points, false).stroke({ width: WALL_PX * px, color, alpha, join: 'round', cap: 'round' })
    }
    // Linked points (same spot) are one point: one dot, one ring. Green where a door ends.
    const doorEnds = new Set(walls.filter((w) => w.door).flatMap((w) => w.points.map(spotKey)))
    for (const p of uniquePositions(walls.flatMap((w) => w.points))) {
      const isDoor = doorEnds.has(spotKey(p))
      g.circle(p.x, p.y, WALL_DOT_PX * px).fill(isDoor ? DOOR_COLOR : WALL_COLOR)
    }
    for (const wall of walls) {
      if (!wall.door) continue
      const c = doorMiddle(wall.points)
      const r = DOOR_BUTTON_PX * px
      g.circle(c.x, c.y, r).fill({ color: 0x1d1d22, alpha: 0.9 }).stroke({ width: 2 * px, color: DOOR_COLOR })
      // A door leaf: solid when closed, an outline when open.
      const leaf = g.roundRect(c.x - 3.5 * px, c.y - 5.5 * px, 7 * px, 11 * px, 1 * px)
      if (wall.door.open) leaf.stroke({ width: 1.5 * px, color: DOOR_COLOR })
      else leaf.fill(DOOR_COLOR)
    }
    const selected = selectedPoints.map((r) => walls.find((w) => w.id === r.wallId)?.points[r.index]).filter((p) => !!p)
    for (const p of uniquePositions(selected)) {
      g.circle(p.x, p.y, (WALL_DOT_PX + 3) * px).stroke({ width: 2 * px, color: 0xffffff })
    }
  }

  /** A door's open/close button at p. */
  doorAt(p: Point, walls: Wall[], px: number): Target {
    for (const w of walls) {
      if (!w.door) continue
      const c = doorMiddle(w.points)
      if (Math.hypot(p.x - c.x, p.y - c.y) <= (DOOR_BUTTON_PX + 2) * px) return { kind: 'door', id: w.id }
    }
    return null
  }

  /** A wall's point at p (the last of a wall's points first). */
  pointAt(p: Point, walls: Wall[], px: number): Target {
    for (const w of walls) {
      for (let index = w.points.length - 1; index >= 0; index--) {
        const q = w.points[index]
        if (Math.hypot(p.x - q.x, p.y - q.y) <= (WALL_DOT_PX + SLACK_PX) * px) return { kind: 'wallPoint', ref: { wallId: w.id, index } }
      }
    }
    return null
  }
}
