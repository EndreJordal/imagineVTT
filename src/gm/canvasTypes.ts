/** The GM canvas's handlers, the UI state it shows, and what can be dragged or pointed at. */
import type { Container, Graphics, Sprite } from 'pixi.js'
import type { MapObject } from '../shared/mapObjects'
import type { GmCamera } from '../shared/sceneFile'
import type { Turn } from '../shared/handout'
import type { MapInfo, Point, Scene, Size } from '../shared/types'
import type { WallPointRef } from '../shared/walls'
import type { GmStore } from './store'

export interface Handlers {
  /**
   * The GM dragged the table view's marker; view is its new centre. `force` (Alt held)
   * skips vision safety. Returning false refuses the move and drops the drag.
   */
  onViewMove(view: Point, force: boolean): boolean
  /** The GM dragged a corner of the table view: zoom it (1 = true scale). */
  onViewZoom(zoom: number): void
  /** Hide-areas dropper: a click at p. */
  onHideFill(p: Point): void
  /**
   * Hide-areas brush: a stroke from `from` to `to`, hiding or (erase) revealing. `stroke`
   * is the same for every segment of one press and drag.
   */
  onHidePaint(from: Point, to: Point, erase: boolean, stroke: string): void
  /** The GM right-clicked a door's button: its settings. */
  onDoorSettings(id: string): void
  /** The GM clicked a hidden area's token (null: nothing). */
  onHiddenSelect(id: string | null): void
  /** The GM dragged the map's corner handle; scale is relative to the image's natural size. */
  onMapResize(scale: number): void
  /** The GM dragged the map; position is its new top-left corner. */
  onMapMove(position: Point): void
  /** The GM dragged a light token to position (like onViewMove for `force` and refusing). */
  onLightMove(id: string, position: Point, force: boolean): boolean
  /** The GM dragged a directional light's aim handle; angle in radians. */
  onLightAim(id: string, angle: number): void
  /** Select just this light, or none (null). */
  onLightSelect(id: string | null): void
  /** Ctrl/Cmd-click: add the light to the selection, or take it out. */
  onLightToggle(id: string): void
  /** In placement mode, the GM clicked the map here. Shift keeps placing more. */
  onPlaceLight(at: Point, keepPlacing: boolean): void
  /** Right-click while using a tool: the same as Enter (confirm / done). */
  onToolConfirm(): void
  /** In wall building mode, the GM clicked: add this (already snapped) wall point. */
  onWallPoint(p: Point): void
  /** Select just this wall point. */
  onWallPointSelect(ref: WallPointRef): void
  /** Ctrl/Cmd-click: add the wall point to the selection, or take it out. */
  onWallPointToggle(ref: WallPointRef): void
  /**
   * The GM dragged a wall point: move `refs` (the points moving together) so that `anchor`,
   * the one under the pointer, ends up at `to` (already snapped).
   */
  onWallPointDrag(refs: WallPointRef[], anchor: WallPointRef, to: Point): void
  /** In door building mode, the GM clicked a valid door point (on a wall line). */
  onDoorPoint(p: Point): void
  /** The GM clicked a door's open/close button. */
  onDoorToggle(id: string): void
  /** Select just this object. */
  onObjectSelect(id: string): void
  /** The GM moved, resized or rotated an object. */
  /** Ctrl+click with one object selected: a copy of it, centred at p. */
  onObjectCopy(p: Point): void
  onObjectChange(id: string, patch: Partial<Pick<MapObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>>): void
  /** Shift-drag box selection; `add` keeps what was already selected (Ctrl/Cmd). */
  onBoxSelect(lightIds: string[], wallPoints: WallPointRef[], objectIds: string[], add: boolean, characterIds: string[]): void
  /** Shift+click on an object or light: in or out of the selection. */
  onObjectToggle(id: string): void
  /** A sound's token clicked (null: nothing). */
  onSoundSelect(id: string | null): void
  /** A sound's token dragged to p. */
  onSoundMove(id: string, p: Point): void
  /** A sound's play button. */
  onSoundPlay(id: string): void
  /** The padlock beside the map's resize square clicked (locks or unlocks the map). */
  onMapLockToggle(): void
  /** A character token clicked (null: nothing). */
  onCharacterSelect(id: string | null): void
  /** A character token in or out of the selection (Shift+click). */
  onCharacterToggle(id: string): void
  /** Character tokens dropped (dragged by one of them): moved together by (dx, dy). */
  onCharactersMove(ids: string[], dx: number, dy: number): void
  /** A grouped light or object clicked: select its group. */
  onGroupSelect(id: string): void
  /** Several selected objects dragged together. */
  onObjectsMove(ids: string[], dx: number, dy: number): void
  /** The GM panned or zoomed (or the view was fitted). */
  onCameraChange(camera: GmCamera): void
}

/** The GM's state the canvas shows (GM-only), as it is in the store. */
export const UI_KEYS = [
  'tableScreen',
  'tableConnected',
  'selectedLightIds',
  'tool',
  'peeking',
  'snap',
  'wallDraft',
  'selectedWallPoints',
  'selectedObjectIds',
  'doorDraft',
  'hideBrush',
  'selectedHiddenId',
  'selectedSoundId',
  'selectedCharacterIds',
] as const satisfies readonly (keyof GmStore)[]

/** What the canvas shows besides the scene: the store's UI_KEYS, and what's worked out from it. */
export type GmUi = Pick<GmStore, (typeof UI_KEYS)[number]> & {
  /** Another floor's map shown faintly over this one, to line them up (onion skin). */
  onion: { image: Blob; map: MapInfo } | null
  /** The curtain is down: the table shows a picture instead of the map. */
  curtainDown: boolean
  /** The picture shown to the players (its size and turn), outlined in the table view. */
  handout: { size: Size; turn: Turn; fill: boolean } | null
  /**
   * Lights in the scene that are only visiting: the party (on the table's floor) shown on a
   * floor being prepared, to line them up with it. Drawn faintly; they can't be picked up.
   */
  ghostLightIds: string[]
}

export type Drag =
  | { mode: 'pan'; last: Point }
  // grab = offset from the pointer to the thing being dragged, in scene space
  | { mode: 'view'; grab: Point }
  // base: the pointer's distance from the view's centre that means true scale (zoom 1).
  | { mode: 'viewZoom'; base: number }
  | { mode: 'sound'; id: string; grab: Point }
  /** Dragging a character token: a ghost shows where it'll go; it slides there on release. */
  | { mode: 'character'; id: string; grab: Point; to: Point | null; ids: string[]; wasSelected: boolean }
  | { mode: 'map'; grab: Point }
  | { mode: 'resize'; grab: Point }
  // wasSelected: the light was already selected when pressed, so a click (no drag) narrows
  // a multi-selection down to it, while a drag moves the whole selection.
  | { mode: 'light'; id: string; grab: Point; wasSelected: boolean }
  | { mode: 'aim'; id: string }
  // refs: the points moving together, fixed when the drag starts (so passing over another
  // point doesn't pick it up). Alt drags just the one point, pulling linked points apart.
  | { mode: 'wallPoint'; ref: WallPointRef; refs: WallPointRef[]; wasSelected: boolean }
  // Shift-drag selection box, in scene coordinates.
  | { mode: 'box'; start: Point; end: Point }
  // group: the objects moving together (the selection, if this one's in it); last: the
  // pointer's last scene position, for moving the group by the difference.
  | { mode: 'object'; id: string; grab: Point; group: string[]; last: Point; wasSelected: boolean }
  // Resizing scales about the centre, keeping the shape: by the pointer's distance from it.
  | { mode: 'objectResize'; id: string; startDist: number; startW: number; startH: number; cursor: string }
  | { mode: 'objectRotate'; id: string }

/**
 * What the pointer is over, in priority order of grabbing. 'locked' is the resize handle of
 * a map locked to the grid.
 */
export type Target =
  | {
      kind: 'door' | 'aim' | 'light' | 'hidden' | 'sound' | 'soundPlay' | 'character' | 'object' | 'objectRotate'
      id: string
    }
  /** A selected object's corner handle, with the resize cursor for its direction. */
  | { kind: 'objectResize'; id: string; cursor: string }
  | { kind: 'wallPoint'; ref: WallPointRef }
  | { kind: 'view' | 'viewZoom' | 'map' | 'resize' | 'locked' | 'mapLock' }
  | null

/** The resize cursor for a handle in direction (dx, dy) from the middle (screen y down). */
export function resizeCursor(dx: number, dy: number) {
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 180
  if (a < 22.5 || a >= 157.5) return 'ew-resize'
  if (a < 67.5) return 'nwse-resize'
  if (a < 112.5) return 'ns-resize'
  return 'nesw-resize'
}

export const CURSORS: Record<Drag['mode'] | 'locked' | 'door' | 'hidden' | 'soundPlay' | 'mapLock', string> = {
  mapLock: 'pointer',
  hidden: 'pointer',
  soundPlay: 'pointer',
  sound: 'move',
  character: 'grab',
  pan: 'grab',
  view: 'move',
  viewZoom: 'nwse-resize',
  map: 'move',
  resize: 'nwse-resize',
  locked: 'not-allowed',
  light: 'move',
  aim: 'crosshair',
  wallPoint: 'move',
  box: 'crosshair',
  door: 'pointer',
  object: 'move',
  objectResize: 'nwse-resize',
  objectRotate: 'grab',
}

/** What each kind draws from: the scene, the GM's UI state, and one screen pixel in scene units. */
export interface View {
  scene: Scene
  ui: GmUi
  px: number
}

/** A GM-only token: an icon in a ring, kept the same size on screen. */
export interface Token {
  root: Container
  ring: Graphics
  icon: Sprite
}
