import type { Graphics } from 'pixi.js'
import { snapToGrid } from '../shared/geometry'
import { LIGHT_PRESETS } from '../shared/lights'
import type { Point, Scene } from '../shared/types'
import { nearestOnSegment, type WallPointRef } from '../shared/walls'
import { iconCursor } from './canvasIcons'
import {
  DOOR_COLOR,
  DOOR_REACH_PX,
  HIDDEN_COLOR,
  WATER_COLOR,
  SLACK_PX,
  SNAP_MARKER_PX,
  TOKEN_PX,
  WALL_COLOR,
  WALL_DOT_PX,
  WALL_PX,
} from './canvasStyle'
import type { Handlers } from './GmCanvas'
import type { Tool } from './tools'

/**
 * The GM canvas's tools (all but selecting and dragging, which is the canvas's own): what a
 * press, a move and a release do with each, its cursor, and what it draws (snap markers,
 * the wall or door being drawn, the brush). Adding a tool: a case in createTool, and a
 * button in the palette.
 */

/** What a tool sees of the canvas, and can do. */
export interface ToolCanvas {
  scene(): Scene | undefined
  /** One GM screen pixel, in scene units. */
  px(): number
  /** Snap fraction of a square (0: none). */
  snap(): number
  wallDraft(): Point[]
  doorDraft(): Point | null
  /** Hide brush radius, in squares. */
  hideBrush(): number
  /** Water brush radius, in squares. */
  waterBrush(): number
  readonly handlers: Handlers
  /** The door whose open/close button is at p, if any. */
  doorButtonAt(p: Point): string | null
  /** Keep getting this pointer's moves (and its release) while it's dragged. */
  capture(e: PointerEvent): void
}

export interface CanvasTool {
  /** The left button went down at p. */
  down(c: ToolCanvas, p: Point, e: PointerEvent): void
  /** The pointer moved to p; `pressed` while dragging since a down this tool captured. */
  move(c: ToolCanvas, p: Point, e: PointerEvent, pressed: boolean): void
  /** The pointer's let go after a captured down. */
  up?(c: ToolCanvas): void
  /** The cursor over the map. */
  cursor(c: ToolCanvas, p: Point | null): string
  /** Previews, into a cleared layer over everything. */
  draw(c: ToolCanvas, g: Graphics): void
}

/** The canvas side of a tool; null for selecting and dragging. */
export function createTool(tool: Tool): CanvasTool | null {
  switch (tool.kind) {
    case 'select':
      return null
    case 'walls':
      return wallTool()
    case 'doors':
      return doorTool()
    case 'light':
      return lightTool(tool.light)
    case 'hide':
      return tool.mode === 'fill' ? fillTool() : brushTool(tool.mode === 'erase')
    case 'measure':
      return measureTool()
    case 'water':
      return tool.mode === 'fill'
        ? { ...fillTool(), down: (c, p) => c.handlers.onWaterFill(p) }
        : brushTool(tool.mode === 'erase', 'water')
  }
}

/** Measuring: press, drag and let go (the store snaps, keeps or drops it). Alt: no snapping. */
function measureTool(): CanvasTool {
  return {
    down(c, p, e) {
      c.handlers.onMeasureStart(p, e.altKey)
      c.capture(e)
    },
    move(c, p, e, pressed) {
      if (pressed) c.handlers.onMeasureMove(p, e.altKey)
    },
    up: (c) => c.handlers.onMeasureEnd(),
    cursor: () => 'crosshair',
    draw() {},
  }
}

/** Building walls: clicks add snapped points; the next segment previewed up to the cursor. */
function wallTool(): CanvasTool {
  let at: Point | null = null
  return {
    down: (c, p) => c.handlers.onWallPoint(wallPointAt(c, p)),
    move: (c, p) => (at = wallPointAt(c, p)),
    cursor: () => iconCursor('walls'),
    draw(c, g) {
      const px = c.px()
      const draft = c.wallDraft()
      if (draft.length > 1) g.poly(draft, false).stroke({ width: WALL_PX * px, color: WALL_COLOR, join: 'round', cap: 'round' })
      const last = draft.at(-1)
      if (last && at) {
        g.moveTo(last.x, last.y).lineTo(at.x, at.y).stroke({ width: WALL_PX * px, color: WALL_COLOR, alpha: 0.6, cap: 'round' })
      }
      for (const p of draft) g.circle(p.x, p.y, WALL_DOT_PX * px).fill(WALL_COLOR)
      if (at) snapMarker(g, at, WALL_COLOR, px)
    },
  }
}

/** Building doors: two clicks on a wall line (or two wall ends across a gap) make a door; clicking a door's button toggles it. */
function doorTool(): CanvasTool {
  let at: Point | null = null
  return {
    down(c, p) {
      const door = c.doorButtonAt(p)
      if (door) return c.handlers.onDoorToggle(door)
      const point = doorPointAt(c, p)
      if (point) c.handlers.onDoorPoint(point)
    },
    move: (c, p) => (at = doorPointAt(c, p)),
    cursor: (c, p) => (p && c.doorButtonAt(p) ? 'pointer' : iconCursor('doors')),
    draw(c, g) {
      const px = c.px()
      const first = c.doorDraft()
      if (first && at) {
        g.moveTo(first.x, first.y).lineTo(at.x, at.y).stroke({ width: WALL_PX * px, color: DOOR_COLOR, alpha: 0.6, cap: 'round' })
      }
      if (first) g.circle(first.x, first.y, WALL_DOT_PX * 1.5 * px).fill(DOOR_COLOR)
      if (at) snapMarker(g, at, DOOR_COLOR, px)
    },
  }
}

/** Placing a light: a click places it (Shift: and keep placing), at the snap point ringed. */
function lightTool(kind: keyof typeof LIGHT_PRESETS): CanvasTool {
  let at: Point | null = null
  return {
    down: (c, p, e) => c.handlers.onPlaceLight(lightPointAt(c, p), e.shiftKey),
    move: (c, p) => (at = lightPointAt(c, p)),
    cursor: () => iconCursor(LIGHT_PRESETS[kind].icon),
    draw(c, g) {
      if (!at || c.snap() <= 0) return
      g.circle(at.x, at.y, (TOKEN_PX + 2) * c.px()).stroke({ width: 2 * c.px(), color: 0xffffff, alpha: 0.8 })
    },
  }
}

/** Hiding areas, dropper: a click fills the enclosed space (or selects the area there). */
function fillTool(): CanvasTool {
  return {
    down: (c, p) => c.handlers.onHideFill(p),
    move: () => {},
    cursor: () => iconCursor('fill'),
    draw: () => {},
  }
}

/** Hiding areas, brush (or eraser): strokes paint, Alt doing the opposite. */
/** A brush: hiding areas (and erasing them), or painting water. */
function brushTool(eraser: boolean, paints: 'hide' | 'water' = 'hide'): CanvasTool {
  const paint = (c: ToolCanvas, from: Point, to: Point, erase: boolean, id: string) =>
    paints === 'water' ? c.handlers.onWaterPaint(from, to, erase, id) : c.handlers.onHidePaint(from, to, erase, id)
  let at: Point | null = null
  let erase = eraser
  let stroke: { id: string; last: Point } | null = null
  return {
    down(c, p, e) {
      erase = eraser !== e.altKey
      stroke = { id: crypto.randomUUID(), last: p }
      paint(c, p, p, erase, stroke.id)
      c.capture(e)
    },
    move(c, p, e, pressed) {
      at = p
      if (!pressed || !stroke) {
        erase = eraser !== e.altKey
        return
      }
      paint(c, stroke.last, p, erase, stroke.id)
      stroke.last = p
    },
    up: () => (stroke = null),
    cursor: () => 'crosshair',
    draw(c, g) {
      const scene = c.scene()
      if (!at || !scene) return
      const r = (paints === 'water' ? c.waterBrush() : c.hideBrush()) * scene.grid.size
      g.circle(at.x, at.y, r).stroke({ width: 3 * c.px(), color: 0x000000, alpha: 0.6 })
      g.circle(at.x, at.y, r).stroke({ width: 1.5 * c.px(), color: erase ? 0xffffff : paints === 'water' ? WATER_COLOR : HIDDEN_COLOR })
    },
  }
}

function snapMarker(g: Graphics, at: Point, color: number, px: number) {
  g.circle(at.x, at.y, SNAP_MARKER_PX * px).fill({ color, alpha: 0.85 }).stroke({ width: 1.5 * px, color: 0xffffff })
}

/**
 * Where a wall point would go for pointer position p: onto an existing wall point under the
 * pointer (so walls join exactly, even without grid snap), else the nearest grid snap point.
 * `moving` points are skipped, so a dragged point doesn't snap onto itself.
 */
export function wallPointAt(c: ToolCanvas, p: Point, moving: WallPointRef[] = []): Point {
  const px = c.px()
  // Corners first: the nearest within reach.
  const near = (WALL_DOT_PX + SLACK_PX) * px
  let best: Point | undefined
  let bestDist = Infinity
  const consider = (q: Point, reach = near) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d <= reach && d < bestDist) {
      best = q
      bestDist = d
    }
  }
  const walls = c.scene()?.walls ?? []
  const isMoving = (wallId: string, index: number) => moving.some((r) => r.wallId === wallId && r.index === index)
  for (const w of walls) {
    w.points.forEach((q, index) => {
      if (!isMoving(w.id, index)) consider(q)
    })
  }
  const draft = c.wallDraft()
  // The first point of the wall being drawn reaches a little further, to close a room.
  draft.forEach((q, i) => consider(q, i === 0 && draft.length > 2 ? near + CLOSE_PX * px : near))
  if (best) return { x: best.x, y: best.y }
  // Then onto a wall line, only very close (doors aren't wall lines to join).
  let line: Point | undefined
  let lineDist = LINE_SNAP_PX * px
  const onto = (a: Point, b: Point) => {
    const hit = nearestOnSegment(p, a, b)
    if (hit.distance <= lineDist) {
      line = hit.point
      lineDist = hit.distance
    }
  }
  for (const w of walls) {
    if (w.door) continue
    for (let i = 1; i < w.points.length; i++) if (!isMoving(w.id, i - 1) && !isMoving(w.id, i)) onto(w.points[i - 1], w.points[i])
  }
  for (let i = 1; i < draft.length; i++) onto(draft[i - 1], draft[i])
  if (line) return line
  const grid = c.scene()?.grid
  return grid ? snapToGrid(p, grid, c.snap()) : p
}

/** How close (GM screen px) a new wall point must be to a wall line to land on it. */
const LINE_SNAP_PX = 6
/** How much further the first point of the wall being drawn reaches, to close a room. */
const CLOSE_PX = 6

/**
 * The door point the door tool would use for pointer position p, or null: an existing wall
 * point under the pointer, else the nearest snap point lying on a wall line (with snapping
 * off, the nearest spot on the line). Doors themselves aren't wall lines to put doors in.
 */
function doorPointAt(c: ToolCanvas, p: Point): Point | null {
  const scene = c.scene()
  if (!scene) return null
  const px = c.px()
  for (const w of scene.walls) {
    for (const q of w.points) {
      if (Math.hypot(p.x - q.x, p.y - q.y) <= (WALL_DOT_PX + SLACK_PX) * px) return { x: q.x, y: q.y }
    }
  }
  const { grid } = scene
  const step = grid.size * c.snap()
  let best: Point | null = null
  let bestDist = DOOR_REACH_PX * px
  const consider = (q: Point) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d <= bestDist) {
      best = q
      bestDist = d
    }
  }
  for (const w of scene.walls) {
    if (w.door) continue
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1]
      const b = w.points[i]
      const near = nearestOnSegment(p, a, b)
      if (near.distance > DOOR_REACH_PX * px) continue
      if (step <= 0) {
        consider(near.point)
        continue
      }
      // Snap points around where the pointer meets the line; keep those on the line.
      const centre = snapToGrid(near.point, grid, c.snap())
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const q = { x: centre.x + dx * step, y: centre.y + dy * step }
          if (nearestOnSegment(q, a, b).distance < 1e-3) consider(q)
        }
      }
    }
  }
  return best
}

/** Where a light placed at pointer position p goes: the nearest snap point, like walls. */
function lightPointAt(c: ToolCanvas, p: Point): Point {
  const grid = c.scene()?.grid
  return grid ? snapToGrid(p, grid, c.snap()) : p
}
