import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { PixiHost } from '../render/PixiHost'
import { iconTexture, loadCanvasIcons } from './canvasIcons'
import { SceneLayer } from '../render/SceneLayer'
import {
  mapScaleForCorner,
  pointInPolygon,
  sceneBounds,
  tableViewCorners,
  upMarker,
} from '../shared/geometry'
import { emitsLight, isDirectional, LIGHT_PRESETS, type Light } from '../shared/lights'
import type { FogMemory } from '../shared/fog'
import { hitsObject, objectCorners, type AssetImages, type MapObject } from '../shared/mapObjects'
import type { GmCamera } from '../shared/sceneFile'
import {
  inRect,
  rectBetween,
  sameRef,
  spotKey,
  uniquePositions,
  wallPointsIn,
  withLinked,
  type WallPointRef,
} from '../shared/walls'
import type { MapInfo, Point, TableState } from '../shared/types'
import { createTool, wallPointAt, type CanvasTool, type ToolCanvas } from './canvasTools'
import {
  DOOR_COLOR,
  HIDDEN_COLOR,
  SLACK_PX,
  TOKEN_PX,
  WALL_COLOR,
  WALL_DOT_PX,
  WALL_PX,
} from './canvasStyle'
import type { GmStore } from './store'
import { SELECT } from './tools'
import { doorMiddle } from '../shared/doors'
import { activeAreas, areaCentre } from '../shared/hidden'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const VIEW_COLOR = 0xffb020
/** Sounds' tokens and ranges. */
const SOUND_COLOR = 0x4dd2c0
/** A sound's play button: its radius, and how far right of the token it sits (GM screen px). */
const PLAY_PX = 8
const PLAY_OFFSET_PX = 24
/** Half the size of the table view's corner handles, in GM screen px. */
const VIEW_CORNER_PX = 5
/** The table view's outline while the curtain is down (the players see a picture, not the map). */
const CURTAIN_COLOR = 0xd94dff
const HANDLE_COLOR = 0x4da3ff
const LOCKED_COLOR = 0x8a8a94
/** Map resize handle half-size, in GM screen pixels (larger when locked, to fit a padlock). */
const HANDLE_PX = 7
const LOCKED_HANDLE_PX = 10
/** Table-view "up" marker size (the drag handle for the view), in GM screen pixels. */
const MARKER_PX = 20
/** Smallest map scale the resize handle allows. */
const MIN_MAP_SCALE = 0.05
/** How far out a directional light's aim handle sits, in GM screen px. */
const AIM_PX = 44
const AIM_HANDLE_PX = 6
/** Pointer travel (screen px) below which a press counts as a click, not a drag. */
const CLICK_PX = 4

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
  onBoxSelect(lightIds: string[], wallPoints: WallPointRef[], objectIds: string[], add: boolean): void
  /** Shift+click on an object or light: in or out of the selection. */
  onObjectToggle(id: string): void
  /** A sound's token clicked (null: nothing). */
  onSoundSelect(id: string | null): void
  /** A sound's token dragged to p. */
  onSoundMove(id: string, p: Point): void
  /** A sound's play button. */
  onSoundPlay(id: string): void
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
] as const satisfies readonly (keyof GmStore)[]

/** What the canvas shows besides the scene: the store's UI_KEYS, and what's worked out from it. */
export type GmUi = Pick<GmStore, (typeof UI_KEYS)[number]> & {
  /** Another floor's map shown faintly over this one, to line them up (onion skin). */
  onion: { image: Blob; map: MapInfo } | null
  /** The curtain is down: the table shows a picture instead of the map. */
  curtainDown: boolean
  /**
   * Lights in the scene that are only visiting: the party (on the table's floor) shown on a
   * floor being prepared, to line them up with it. Drawn faintly; they can't be picked up.
   */
  ghostLightIds: string[]
}

type Drag =
  | { mode: 'pan'; last: Point }
  // grab = offset from the pointer to the thing being dragged, in scene space
  | { mode: 'view'; grab: Point }
  // base: the pointer's distance from the view's centre that means true scale (zoom 1).
  | { mode: 'viewZoom'; base: number }
  | { mode: 'sound'; id: string; grab: Point }
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
  | { mode: 'objectResize'; id: string; startDist: number; startW: number; startH: number }
  | { mode: 'objectRotate'; id: string }

/**
 * What the pointer is over, in priority order of grabbing. 'locked' is the resize handle of
 * a map locked to the grid.
 */
type Target =
  | { kind: 'door' | 'aim' | 'light' | 'hidden' | 'sound' | 'soundPlay' | 'object' | 'objectResize' | 'objectRotate'; id: string }
  | { kind: 'wallPoint'; ref: WallPointRef }
  | { kind: 'view' | 'viewZoom' | 'map' | 'resize' | 'locked' }
  | null

const CURSORS: Record<Drag['mode'] | 'locked' | 'door' | 'hidden' | 'soundPlay', string> = {
  hidden: 'pointer',
  soundPlay: 'pointer',
  sound: 'move',
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


interface Token {
  root: Container
  ring: Graphics
  icon: Sprite
}

const OBJECT_COLOR = 0x4da3ff
/** Selected object's corner handles (half-size) and rotation handle (radius, distance out), GM px. */
const OBJECT_HANDLE_PX = 5
const ROTATE_HANDLE_PX = 6
const ROTATE_OUT_PX = 26
/** A door's open/close button (in its middle), radius in GM screen px. */
const DOOR_BUTTON_PX = 10

/** Size of a light token's icon, in GM screen px. */
const ICON_PX = 18


/**
 * GM's interactive map view. Left-drag moves the map image, its corner handle resizes it,
 * and the table view's marker moves the table view. Light tokens (GM-only) can be dragged
 * and clicked to select; a selected directional light has an aim handle. Dragging empty
 * space, or right/middle drag anywhere, pans the camera; the wheel zooms.
 */
export class GmCanvas extends PixiHost {
  private camera = new Container()
  private sceneLayer = new SceneLayer()
  private viewOverlay = new Graphics()
  private mapHandle = new Graphics()
  /** Drawn separately so the drag handle stays fully opaque while the view is dimmed. */
  private viewMarker = new Graphics()
  private lightTokens = new Container()
  /** Hidden areas' tokens (GM-only), at each area's middle. */
  private hiddenTokens = new Container()
  private hiddenTokenMap = new Map<string, Token>()
  /** Sounds' tokens (GM-only), each with a play button, and the selected one's range. */
  private soundTokens = new Container()
  private soundTokenMap = new Map<string, Token & { play: Graphics }>()
  private soundRange = new Graphics()
  private tokens = new Map<string, Token>()
  private aimHandle = new Graphics()
  /** Faint rings showing how far the selected vision tokens see. */
  private visionRings = new Graphics()
  /** Walls (GM-only: players only see their effect on sight). */
  private wallsLayer = new Graphics()
  /** Onion skin: another floor's map, faint, to line this one up with it. */
  private onionSprite = new Sprite({ alpha: 0.3 })
  private onionImage: Blob | null = null
  private onion: GmUi['onion'] = null
  private onionToken = 0
  /** Outline and handles of the selected objects. */
  private objectHandles = new Graphics()
  private selectedObjectIds = new Set<string>()
  /** What the tool in hand draws: the wall or door being drawn, snap markers, the brush. */
  private toolLayer = new Graphics()
  /** The Shift-drag selection box. */
  private selectionBox = new Graphics()
  private wallsDrawn: { walls: unknown; px: number; selected: WallPointRef[] } | null = null
  private ui: GmUi = {
    tableScreen: { width: 1920, height: 1080 },
    tableConnected: false,
    selectedLightIds: [],
    tool: SELECT,
    peeking: false,
    snap: 1,
    wallDraft: [],
    selectedWallPoints: [],
    selectedObjectIds: [],
    doorDraft: null,
    hideBrush: 1,
    selectedHiddenId: null,
    selectedSoundId: null,
    onion: null,
    curtainDown: false,
    ghostLightIds: [],
  }
  /** Selections as sets, for looking up (kept while the store's arrays are the same). */
  private selectedLightIds = new Set<string>()
  private ghostLightIds = new Set<string>()
  /** The tool in hand's canvas side (null: selecting and dragging). */
  private active: CanvasTool | null = null
  /** The tool captured the pointer: its moves and release are the tool's. */
  private toolPressed = false
  /** The pointer's last scene position (for the tool's cursor). */
  private pointer: Point | null = null
  /** What tools see of the canvas, and can do. */
  private readonly toolView: ToolCanvas
  private fogMemory: FogMemory | null = null
  private fogVersion = -1
  /** Where the current press started (canvas px), to tell clicks from drags. */
  private pressedAt: Point | null = null
  private state: TableState | null = null
  private image: Blob | null = null
  private marker: Point[] | null = null
  /** The table view's corners (also handles for zooming it), as last drawn. */
  private viewCorners: Point[] | null = null
  private drag: Drag | null = null
  private fitted = false
  /** A camera to show instead of fitting the map, once the canvas is ready. */
  private pendingCamera: GmCamera | null = null
  private handlers: Handlers

  constructor(host: HTMLElement, handlers: Handlers) {
    super(host, '#141417')
    this.handlers = handlers
    this.toolView = {
      scene: () => this.state?.scene,
      px: () => this.px,
      snap: () => this.ui.snap,
      wallDraft: () => this.ui.wallDraft,
      doorDraft: () => this.ui.doorDraft,
      hideBrush: () => this.ui.hideBrush,
      handlers,
      doorButtonAt: (p) => {
        const target = this.targetAt(p)
        return target?.kind === 'door' ? target.id : null
      },
      capture: (e) => {
        this.toolPressed = true
        this.app.canvas.setPointerCapture(e.pointerId)
      },
    }
  }

  protected setup() {
    this.camera.addChild(
      this.sceneLayer,
      this.onionSprite,
      this.viewOverlay,
      this.mapHandle,
      this.viewMarker,
      this.objectHandles,
      this.wallsLayer,
      this.visionRings,
      this.hiddenTokens,
      this.soundRange,
      this.soundTokens,
      this.lightTokens,
      this.aimHandle,
      this.selectionBox,
      this.toolLayer,
    )
    this.app.stage.addChild(this.camera)
    this.sceneLayer.onChange = () => this.requestRender()
    // Light token icons decode in the background: draw the tokens again once they're in.
    void loadCanvasIcons().then(() => this.render())
    void this.sceneLayer.setMapImage(this.image).then(() => this.requestRender())
    this.sceneLayer.setFogMemory(this.fogMemory)

    const canvas = this.app.canvas
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.render()
  }

  update(state: TableState, ui: GmUi) {
    const was = this.ui
    this.state = state
    this.ui = ui
    if (ui.selectedLightIds !== was.selectedLightIds) this.selectedLightIds = new Set(ui.selectedLightIds)
    if (ui.selectedObjectIds !== was.selectedObjectIds) this.selectedObjectIds = new Set(ui.selectedObjectIds)
    this.ghostLightIds = new Set(ui.ghostLightIds)
    this.setOnion(ui.onion)
    if (ui.tool !== was.tool) {
      this.active = createTool(ui.tool)
      this.toolPressed = false
      if (this.ready) this.app.canvas.style.cursor = this.cursorFor(null)
    }
    this.render()
  }

  /** Show (or hide) another floor's map faintly over this one. */
  private setOnion(onion: GmUi['onion']) {
    this.onion = onion
    const s = this.onionSprite
    s.visible = !!onion
    if (!onion) return
    this.placeOnion()
    if (onion.image === this.onionImage) return
    this.onionImage = onion.image
    const token = ++this.onionToken
    // A guide only: a small copy will do.
    const k = Math.min(1, 2048 / Math.max(onion.map.naturalWidth, onion.map.naturalHeight))
    void createImageBitmap(onion.image, {
      resizeWidth: Math.max(1, Math.round(onion.map.naturalWidth * k)),
      resizeHeight: Math.max(1, Math.round(onion.map.naturalHeight * k)),
      resizeQuality: 'medium',
    }).then((bitmap) => {
      if (token !== this.onionToken) return bitmap.close()
      const old = s.texture
      s.texture = Texture.from(bitmap)
      if (old !== Texture.EMPTY) old.destroy(true)
      this.placeOnion()
      this.requestRender()
    })
  }

  /** The onion sprite over its map's placement, turned as that map is. */
  private placeOnion() {
    const map = this.onion?.map
    if (!map) return
    const s = this.onionSprite
    const turns = map.turns ?? 0
    s.anchor.set(0.5)
    s.position.set(map.x + map.width / 2, map.y + map.height / 2)
    s.rotation = (turns * Math.PI) / 2
    // Sized before turning: the image's own width is the shown height when turned a quarter.
    if (turns % 2) s.setSize(map.height, map.width)
    else s.setSize(map.width, map.height)
  }

  /** Images of the assets objects show. */
  setObjectImages(images: AssetImages) {
    this.sceneLayer.setObjectImages(images)
    this.requestRender()
  }

  /** The scene point under a page position (for dropping things onto the map). */
  sceneAt(clientX: number, clientY: number): Point | null {
    if (!this.ready) return null
    const rect = this.app.canvas.getBoundingClientRect()
    const p = this.camera.toLocal({ x: clientX - rect.left, y: clientY - rect.top })
    return { x: p.x, y: p.y }
  }

  /** Fog memory changed (the grid object is updated in place; version tells when). */
  setFogMemory(memory: FogMemory | null, version: number) {
    if (version === this.fogVersion) return
    this.fogVersion = version
    this.fogMemory = memory
    if (this.ready) this.sceneLayer.setFogMemory(memory)
    this.requestRender()
  }

  setMapImage(image: Blob | null) {
    if (image === this.image) return
    this.image = image
    this.fitted = false
    if (this.ready) void this.sceneLayer.setMapImage(image).then(() => this.requestRender())
    this.render()
  }

  /** Zoom the camera so the whole scene fits the GM view. */
  fit() {
    if (!this.ready || !this.state) return
    const bounds = sceneBounds(this.state.scene)
    const screen = this.app.screen
    const zoom = Math.min(screen.width / bounds.width, screen.height / bounds.height) * 0.95
    this.camera.scale.set(zoom)
    this.camera.position.set(
      (screen.width - bounds.width * zoom) / 2 - bounds.x * zoom,
      (screen.height - bounds.height * zoom) / 2 - bounds.y * zoom,
    )
    this.drawOverlay()
    this.reportCamera()
  }

  /**
   * Jump to a saved camera (session restore, scene open). Applied when the scene is next
   * drawn, in place of fitting the map; null fits the map.
   */
  setCamera(camera: GmCamera | null) {
    // Not drawn here: the scene and map image for it may arrive just after.
    this.pendingCamera = camera
    this.fitted = false
  }

  /** Centre the view on the camera's point at its zoom (works for any window size). */
  private applyCamera(c: GmCamera) {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom))
    const screen = this.app.screen
    this.camera.scale.set(zoom)
    this.camera.position.set(screen.width / 2 - c.x * zoom, screen.height / 2 - c.y * zoom)
    this.drawOverlay()
  }

  private reportCamera() {
    const c = this.centre()
    if (c) this.handlers.onCameraChange({ x: c.x, y: c.y, zoom: this.camera.scale.x })
  }

  /** Pan so a scene point is in the middle of the view (the zoom stays). */
  centreOn(p: Point) {
    if (!this.ready) return
    const zoom = this.camera.scale.x
    this.camera.position.set(this.app.screen.width / 2 - p.x * zoom, this.app.screen.height / 2 - p.y * zoom)
    this.drawOverlay()
    this.reportCamera()
  }

  /** Scene-space point at the centre of the GM view. */
  centre(): Point | null {
    if (!this.ready) return null
    const p = this.camera.toLocal({ x: this.app.screen.width / 2, y: this.app.screen.height / 2 })
    return { x: p.x, y: p.y }
  }

  protected override isAnimating() {
    return this.sceneLayer.isAnimating()
  }

  protected override beforeRender(seconds: number) {
    this.sceneLayer.animate(this.app.renderer, seconds)
  }

  private render() {
    if (!this.ready || !this.state) return
    this.requestRender()
    this.sceneLayer.update(this.state.scene, this.ui.peeking ? 'players' : 'gm')
    if (!this.fitted) {
      this.fitted = true
      if (this.pendingCamera) this.applyCamera(this.pendingCamera)
      else this.fit()
      this.pendingCamera = null
    }
    this.drawOverlay()
  }

  /** One GM screen pixel in scene units. */
  private get px() {
    return 1 / this.camera.scale.x
  }

  private drawOverlay() {
    this.requestRender()
    this.drawMapHandle()
    this.drawLights()
    this.drawHiddenTokens()
    this.drawSoundTokens()
    this.drawWalls()
    this.drawObjectHandles()
    const g = this.viewOverlay.clear()
    this.viewMarker.clear()
    this.marker = null
    if (!this.state || !this.ui.tableScreen) return

    const px = this.px
    const corners = tableViewCorners(this.state.scene, this.state.display, this.ui.tableScreen)
    this.viewOverlay.alpha = this.ui.tableConnected ? 1 : 0.5

    // Dim everything the table doesn't show, so the view stands out on any map. The dimmed
    // area must fully enclose the view, or the cut-out hole triangulates wrongly.
    const b = sceneBounds(this.state.scene)
    const xs = [b.x, b.x + b.width, ...corners.map((p) => p.x)]
    const ys = [b.y, b.y + b.height, ...corners.map((p) => p.y)]
    const x0 = Math.min(...xs) - px
    const y0 = Math.min(...ys) - px
    g.rect(x0, y0, Math.max(...xs) + px - x0, Math.max(...ys) + px - y0)
      .fill({ color: 0x000000, alpha: 0.35 })
      .poly(corners)
      .cut()

    // Dark halo under the coloured line keeps it visible on light maps.
    g.poly(corners).stroke({ width: 5 * px, color: 0x000000, alpha: 0.7 })
    const color = this.ui.curtainDown ? CURTAIN_COLOR : VIEW_COLOR
    g.poly(corners).stroke({ width: (this.ui.curtainDown ? 4 : 2) * px, color })

    // The marker on the table's "up" edge doubles as the handle for moving the view.
    this.marker = upMarker(corners, this.state.scene.view, MARKER_PX * px)
    this.viewMarker
      .poly(this.marker)
      .fill(color)
      .stroke({ width: 2 * px, color: 0x000000, alpha: 0.8 })

    // Corner handles: drag one to zoom the table out (an overview) or in.
    this.viewCorners = corners
    const r = VIEW_CORNER_PX * px
    for (const c of corners) {
      this.viewMarker.rect(c.x - r, c.y - r, 2 * r, 2 * r).fill(color).stroke({ width: 1.5 * px, color: 0x000000, alpha: 0.8 })
    }
  }

  private drawMapHandle() {
    const g = this.mapHandle.clear()
    const map = this.state?.scene.map
    if (!map) return
    const px = this.px
    const locked = !!map.lockToGrid
    const color = locked ? LOCKED_COLOR : HANDLE_COLOR
    const r = (locked ? LOCKED_HANDLE_PX : HANDLE_PX) * px
    const cx = map.x + map.width
    const cy = map.y + map.height
    g.rect(map.x, map.y, map.width, map.height).stroke({ width: 1.5 * px, color, alpha: 0.6 })
    g.rect(cx - r, cy - r, 2 * r, 2 * r)
      .fill(color)
      .stroke({ width: 1.5 * px, color: 0x000000 })
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

  /** Hidden areas' tokens: the crossed-out eye, at each area's middle. GM-only. */
  private drawHiddenTokens() {
    const scene = this.state?.scene
    const areas = scene?.hiddenAreas ?? []
    const ids = new Set(areas.map((a) => a.id))
    for (const [id, t] of this.hiddenTokenMap) {
      if (ids.has(id)) continue
      t.root.destroy({ children: true })
      this.hiddenTokenMap.delete(id)
    }
    if (!scene) return
    const bounds = sceneBounds(scene)
    const active = new Set(activeAreas(scene))
    for (const area of areas) {
      let t = this.hiddenTokenMap.get(area.id)
      if (!t) {
        const ring = new Graphics()
        const icon = new Sprite({ anchor: 0.5 })
        t = { root: new Container(), ring, icon }
        t.root.addChild(ring, icon)
        this.hiddenTokens.addChild(t.root)
        this.hiddenTokenMap.set(area.id, t)
      }
      const c = areaCentre(area, bounds)
      t.root.position.set(c.x, c.y)
      t.root.scale.set(this.px)
      t.root.alpha = active.has(area) ? 1 : 0.4 // switched off: kept, not drawn
      t.icon.texture = iconTexture('hide')
      t.icon.setSize(ICON_PX)
      t.ring.clear().circle(0, 0, TOKEN_PX).fill({ color: 0x1d1d22, alpha: 0.85 }).stroke({ width: 2.5, color: HIDDEN_COLOR })
      if (area.id === this.ui.selectedHiddenId) t.ring.circle(0, 0, TOKEN_PX + 3.5).stroke({ width: 2, color: 0xffffff })
    }
  }

  /** Sounds' tokens: a speaker, and a play button beside it. GM-only. */
  private drawSoundTokens() {
    const sounds = this.state?.scene.sounds ?? []
    const ids = new Set(sounds.map((x) => x.id))
    for (const [id, t] of this.soundTokenMap) {
      if (ids.has(id)) continue
      t.root.destroy({ children: true })
      this.soundTokenMap.delete(id)
    }
    const range = this.soundRange.clear()
    const grid = this.state?.scene.grid.size ?? 100
    for (const sound of sounds) {
      let t = this.soundTokenMap.get(sound.id)
      if (!t) {
        const ring = new Graphics()
        const icon = new Sprite({ anchor: 0.5 })
        const play = new Graphics()
        t = { root: new Container(), ring, icon, play }
        t.root.addChild(ring, icon, play)
        this.soundTokens.addChild(t.root)
        this.soundTokenMap.set(sound.id, t)
      }
      t.root.position.set(sound.x, sound.y)
      t.root.scale.set(this.px)
      t.root.alpha = sound.enabled ? 1 : 0.45
      t.icon.texture = iconTexture('sound')
      t.icon.setSize(ICON_PX)
      t.ring.clear().circle(0, 0, TOKEN_PX).fill({ color: 0x1d1d22, alpha: 0.85 }).stroke({ width: 2.5, color: SOUND_COLOR })
      const selected = sound.id === this.ui.selectedSoundId
      if (selected) {
        t.ring.circle(0, 0, TOKEN_PX + 3.5).stroke({ width: 2, color: 0xffffff })
        range.circle(sound.x, sound.y, sound.range * grid).stroke({ width: 1.5 * this.px, color: SOUND_COLOR, alpha: 0.6 })
      }
      // The play button: a loop's switches it on and off (a square while it plays).
      const b = PLAY_OFFSET_PX
      t.play.clear().circle(b, 0, PLAY_PX).fill({ color: SOUND_COLOR }).stroke({ width: 1.5, color: 0x000000, alpha: 0.6 })
      if (sound.loop && sound.enabled) t.play.rect(b - 3, -3, 6, 6).fill(0x1d1d22)
      else t.play.poly([b - 2.5, -4, b + 4, 0, b - 2.5, 4]).fill(0x1d1d22)
    }
  }

  /** Light tokens: constant size on screen, ringed in the light's colour. GM-only. */
  private drawLights() {
    const lights = this.state?.scene.lights ?? []
    const ids = new Set(lights.map((l) => l.id))
    for (const [id, t] of this.tokens) {
      if (ids.has(id)) continue
      t.root.destroy({ children: true })
      this.tokens.delete(id)
    }
    for (const light of lights) {
      let t = this.tokens.get(light.id)
      if (!t) {
        const ring = new Graphics()
        const icon = new Sprite({ anchor: 0.5 })
        t = { root: new Container(), ring, icon }
        t.root.addChild(ring, icon)
        this.lightTokens.addChild(t.root)
        this.tokens.set(light.id, t)
      }
      const selected = this.selectedLightIds.has(light.id)
      t.root.position.set(light.x, light.y)
      t.root.scale.set(this.px)
      // Dimmed when switched off: lights by being unlit, vision tokens by not seeing; faint
      // when only visiting (the party, on a floor being prepared).
      const lit = emitsLight(light) ? light.on : light.vision
      t.root.alpha = (lit ? 1 : 0.55) * (this.ghostLightIds.has(light.id) ? 0.5 : 1)
      t.icon.texture = iconTexture(LIGHT_PRESETS[light.kind].icon)
      t.icon.setSize(ICON_PX)
      t.ring
        .clear()
        .circle(0, 0, TOKEN_PX)
        .fill({ color: 0x1d1d22, alpha: 0.85 })
        .stroke({ width: 2.5, color: light.color })
      if (selected) t.ring.circle(0, 0, TOKEN_PX + 3.5).stroke({ width: 2, color: 0xffffff })
    }

    const rings = this.visionRings.clear()
    const gridSize = this.state?.scene.grid.size ?? 100
    for (const light of lights) {
      if (!light.vision || !this.selectedLightIds.has(light.id)) continue
      rings
        .circle(light.x, light.y, light.visionRange * gridSize)
        .stroke({ width: 1.5 * this.px, color: 0x9ad0ff, alpha: 0.5 })
    }

    // Aim handle for the selected directional light (when it's the only one selected).
    const g = this.aimHandle.clear()
    const selected = this.soleSelected()
    if (selected && isDirectional(selected)) {
      const px = this.px
      const a = this.aimPoint(selected)
      const r = TOKEN_PX * px
      g.moveTo(selected.x + Math.cos(selected.angle) * r, selected.y + Math.sin(selected.angle) * r)
        .lineTo(a.x, a.y)
        .stroke({ width: 2 * px, color: 0xffffff, alpha: 0.8 })
      g.circle(a.x, a.y, AIM_HANDLE_PX * px).fill(0xffffff).stroke({ width: 1.5 * px, color: 0x000000 })
    }
  }

  /**
   * Walls as red lines with dots at their points, doors in green (faded when open) with an
   * open/close button in the middle; the wall or door being drawn, while building.
   */
  private drawWalls() {
    const px = this.px
    const walls = this.state?.scene.walls ?? []
    // Redrawn only when the walls, the zoom or the selection changed (maps can have thousands).
    const d = this.wallsDrawn
    if (d && d.walls === walls && d.px === px && d.selected === this.ui.selectedWallPoints) {
      this.drawTool()
      return
    }
    this.wallsDrawn = { walls, px, selected: this.ui.selectedWallPoints }
    const g = this.wallsLayer.clear()
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
    const selected = this.ui.selectedWallPoints.map((r) => this.wallPoint(r)).filter((p) => !!p)
    for (const p of uniquePositions(selected)) {
      g.circle(p.x, p.y, (WALL_DOT_PX + 3) * px).stroke({ width: 2 * px, color: 0xffffff })
    }
    this.drawTool()
  }

  /** Selected objects: an outline, corner handles to resize, a handle above to rotate. */
  private drawObjectHandles() {
    const g = this.objectHandles.clear()
    const px = this.px
    for (const o of this.selectedObjects()) {
      const corners = objectCorners(o)
      g.poly(corners).stroke({ width: 3 * px, color: 0x000000, alpha: 0.5 })
      g.poly(corners).stroke({ width: 1.5 * px, color: OBJECT_COLOR })
      const r = OBJECT_HANDLE_PX * px
      for (const c of corners) g.rect(c.x - r, c.y - r, 2 * r, 2 * r).fill(0xffffff).stroke({ width: 1.5 * px, color: OBJECT_COLOR })
      const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }
      const h = this.rotateHandle(o)
      g.moveTo(top.x, top.y).lineTo(h.x, h.y).stroke({ width: 1.5 * px, color: OBJECT_COLOR })
      g.circle(h.x, h.y, ROTATE_HANDLE_PX * px).fill(0xffffff).stroke({ width: 1.5 * px, color: OBJECT_COLOR })
    }
  }

  private selectedObjects(): MapObject[] {
    return (this.state?.scene.objects ?? []).filter((o) => this.selectedObjectIds.has(o.id))
  }

  /** Where an object's rotation handle is: above its top edge, turning with it. */
  private rotateHandle(o: MapObject): Point {
    const d = o.height / 2 + ROTATE_OUT_PX * this.px
    return { x: o.x + Math.sin(o.rotation) * d, y: o.y - Math.cos(o.rotation) * d }
  }

  /** The tool in hand's previews. */
  private drawTool() {
    this.requestRender()
    const g = this.toolLayer.clear()
    this.active?.draw(this.toolView, g)
  }

  private wallPoint(ref: WallPointRef): Point | undefined {
    return this.state?.scene.walls.find((w) => w.id === ref.wallId)?.points[ref.index]
  }

  private drawSelectionBox() {
    this.requestRender()
    const g = this.selectionBox.clear()
    if (this.drag?.mode !== 'box') return
    const r = rectBetween(this.drag.start, this.drag.end)
    g.rect(r.x, r.y, r.width, r.height)
      .fill({ color: 0x4da3ff, alpha: 0.1 })
      .stroke({ width: 1.5 * this.px, color: 0x4da3ff })
  }

  /** The selected light, if exactly one is selected. */
  private soleSelected(): Light | undefined {
    if (this.selectedLightIds.size !== 1) return undefined
    const [id] = this.selectedLightIds
    return this.state?.scene.lights.find((l) => l.id === id)
  }

  private aimPoint(light: Light): Point {
    const d = AIM_PX * this.px
    return { x: light.x + Math.cos(light.angle) * d, y: light.y + Math.sin(light.angle) * d }
  }

  /** What a left-drag starting at p would grab, in priority order. */
  private targetAt(p: Point): Target {
    const state = this.state
    if (!state) return null
    const px = this.px
    const map = state.scene.map
    const lights = state.scene.lights

    // Door buttons sit on top of everything.
    for (const w of state.scene.walls) {
      if (!w.door) continue
      const c = doorMiddle(w.points)
      if (Math.hypot(p.x - c.x, p.y - c.y) <= (DOOR_BUTTON_PX + 2) * px) return { kind: 'door', id: w.id }
    }
    const selected = this.soleSelected()
    if (selected && isDirectional(selected)) {
      const a = this.aimPoint(selected)
      if (Math.hypot(p.x - a.x, p.y - a.y) <= (AIM_HANDLE_PX + SLACK_PX) * px) {
        return { kind: 'aim', id: selected.id }
      }
    }
    // Topmost (last drawn) token first.
    for (let i = lights.length - 1; i >= 0; i--) {
      const l = lights[i]
      if (this.ghostLightIds.has(l.id)) continue
      if (Math.hypot(p.x - l.x, p.y - l.y) <= (TOKEN_PX + 2) * px) return { kind: 'light', id: l.id }
    }
    for (const sound of [...(state.scene.sounds ?? [])].reverse()) {
      const play = { x: sound.x + PLAY_OFFSET_PX * px, y: sound.y }
      if (Math.hypot(p.x - play.x, p.y - play.y) <= (PLAY_PX + 2) * px) return { kind: 'soundPlay', id: sound.id }
      if (Math.hypot(p.x - sound.x, p.y - sound.y) <= (TOKEN_PX + 2) * px) return { kind: 'sound', id: sound.id }
    }
    const bounds = sceneBounds(state.scene)
    for (const area of [...(state.scene.hiddenAreas ?? [])].reverse()) {
      const c = areaCentre(area, bounds)
      if (Math.hypot(p.x - c.x, p.y - c.y) <= (TOKEN_PX + 2) * px) return { kind: 'hidden', id: area.id }
    }
    for (const w of state.scene.walls) {
      for (let index = w.points.length - 1; index >= 0; index--) {
        const q = w.points[index]
        if (Math.hypot(p.x - q.x, p.y - q.y) <= (WALL_DOT_PX + SLACK_PX) * px) {
          return { kind: 'wallPoint', ref: { wallId: w.id, index } }
        }
      }
    }

    // Objects: the selected ones' handles, then any object (topmost first).
    for (const o of this.selectedObjects()) {
      const h = this.rotateHandle(o)
      if (Math.hypot(p.x - h.x, p.y - h.y) <= (ROTATE_HANDLE_PX + SLACK_PX) * px) return { kind: 'objectRotate', id: o.id }
      for (const c of objectCorners(o)) {
        if (Math.hypot(p.x - c.x, p.y - c.y) <= (OBJECT_HANDLE_PX + SLACK_PX) * px) return { kind: 'objectResize', id: o.id }
      }
    }
    const objects = state.scene.objects
    for (let i = objects.length - 1; i >= 0; i--) {
      if (hitsObject(objects[i], p)) return { kind: 'object', id: objects[i].id }
    }

    if (map) {
      const r = ((map.lockToGrid ? LOCKED_HANDLE_PX : HANDLE_PX) + SLACK_PX) * px
      const cx = map.x + map.width
      const cy = map.y + map.height
      if (Math.abs(p.x - cx) <= r && Math.abs(p.y - cy) <= r) {
        return { kind: map.lockToGrid ? 'locked' : 'resize' }
      }
    }
    if (this.viewCorners) {
      const r = (VIEW_CORNER_PX + SLACK_PX) * px
      if (this.viewCorners.some((c) => Math.abs(p.x - c.x) <= r && Math.abs(p.y - c.y) <= r)) return { kind: 'viewZoom' }
    }
    if (this.marker) {
      const c = centroid(this.marker)
      if (pointInPolygon(p, this.marker) || Math.hypot(p.x - c.x, p.y - c.y) <= SLACK_PX * 2 * px) {
        return { kind: 'view' }
      }
    }
    const movable = map && !(map.lockX && map.lockY)
    if (movable && p.x >= map.x && p.x <= map.x + map.width && p.y >= map.y && p.y <= map.y + map.height) {
      return { kind: 'map' }
    }
    return null
  }

  private cursorFor(target: Target) {
    if (this.active) return this.active.cursor(this.toolView, this.pointer)
    return CURSORS[target?.kind ?? 'pan']
  }

  /** The group a light or object is in, if any. */
  private groupOf(id: string, kind: 'light' | 'object') {
    const scene = this.state?.scene
    return (kind === 'light' ? scene?.lights : scene?.objects)?.find((x) => x.id === id)?.group
  }

  /**
   * Whether a Ctrl+click here drops a copy of the selected object: one object selected, and
   * nothing under the pointer that Ctrl+click means something else for.
   */
  private copying(e: PointerEvent, target: Target) {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || this.active || this.selectedObjectIds.size !== 1) return false
    return !target || target.kind === 'map' || target.kind === 'object'
  }

  /** Pointer position in canvas CSS pixels (clientX-based; offsetX is unreliable). */
  private toCanvas(e: PointerEvent | WheelEvent): Point {
    const rect = this.app.canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  private toScene(e: PointerEvent | WheelEvent): Point {
    const p = this.camera.toLocal(this.toCanvas(e))
    return { x: p.x, y: p.y }
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button > 2) return
    const p = this.toScene(e)
    // With a tool, right-click confirms like Enter; middle still pans.
    if (this.ui.tool.kind !== 'select' && e.button === 2) {
      this.handlers.onToolConfirm()
      return
    }
    if (this.active && e.button === 0) {
      this.active.down(this.toolView, p, e)
      this.drawTool()
      return
    }
    // Right-click on a door's button: its settings.
    if (e.button === 2) {
      const at = this.targetAt(p)
      if (at?.kind === 'door') return this.handlers.onDoorSettings(at.id)
    }
    const target = e.button === 0 ? this.targetAt(p) : null
    const scene = this.state?.scene
    if (target?.kind === 'locked') return // the resize handle is disabled while locked to the grid
    if (target?.kind === 'door') {
      this.handlers.onDoorToggle(target.id)
      return
    }
    if (this.copying(e, target)) {
      this.handlers.onObjectCopy(p)
      return
    }
    this.pressedAt = this.toCanvas(e)

    if (e.button === 0 && e.shiftKey) {
      // Shift-drag draws a selection box, whatever is under the pointer.
      this.drag = { mode: 'box', start: p, end: p }
    } else if (target?.kind === 'wallPoint') {
      if (e.ctrlKey || e.metaKey) {
        this.handlers.onWallPointToggle(target.ref)
        this.pressedAt = null
        return
      }
      const walls = scene?.walls ?? []
      const wasSelected = this.ui.selectedWallPoints.some((r) => sameRef(r, target.ref))
      if (!wasSelected) this.handlers.onWallPointSelect(target.ref)
      const refs = e.altKey
        ? [target.ref]
        : withLinked(walls, wasSelected ? this.ui.selectedWallPoints : [target.ref])
      this.drag = { mode: 'wallPoint', ref: target.ref, refs, wasSelected }
    } else if (target?.kind === 'object') {
      const o = scene?.objects.find((x) => x.id === target.id)
      if (!o) return
      const wasSelected = this.selectedObjectIds.has(o.id)
      // A grouped object picks up its group (Alt+click: just it).
      if (!wasSelected) {
        if (o.group && !e.altKey) this.handlers.onGroupSelect(o.group)
        else this.handlers.onObjectSelect(o.id)
      }
      const group = wasSelected || (o.group && !e.altKey) ? [...this.selectedObjectIds] : [o.id]
      this.drag = { mode: 'object', id: o.id, grab: { x: o.x - p.x, y: o.y - p.y }, group, last: p, wasSelected }
    } else if (target?.kind === 'objectResize') {
      const o = scene?.objects.find((x) => x.id === target.id)
      if (!o) return
      const startDist = Math.max(1e-6, Math.hypot(p.x - o.x, p.y - o.y))
      this.drag = { mode: 'objectResize', id: o.id, startDist, startW: o.width, startH: o.height }
    } else if (target?.kind === 'objectRotate') {
      this.drag = { mode: 'objectRotate', id: target.id }
    } else if (target?.kind === 'aim') {
      this.drag = { mode: 'aim', id: target.id }
    } else if (target?.kind === 'soundPlay') {
      this.handlers.onSoundPlay(target.id)
      this.pressedAt = null
      return
    } else if (target?.kind === 'sound') {
      const sound = scene?.sounds?.find((x) => x.id === target.id)
      if (!sound) return
      this.handlers.onSoundSelect(sound.id)
      this.drag = { mode: 'sound', id: sound.id, grab: { x: sound.x - p.x, y: sound.y - p.y } }
    } else if (target?.kind === 'hidden') {
      this.handlers.onHiddenSelect(target.id)
      this.pressedAt = null
      return
    } else if (target?.kind === 'light') {
      const light = scene?.lights.find((l) => l.id === target.id)
      if (!light) return
      if (e.ctrlKey || e.metaKey) {
        this.handlers.onLightToggle(light.id)
        this.pressedAt = null
        return
      }
      const wasSelected = this.selectedLightIds.has(light.id)
      if (!wasSelected) {
        if (light.group && !e.altKey) this.handlers.onGroupSelect(light.group)
        else this.handlers.onLightSelect(light.id)
      }
      this.drag = { mode: 'light', id: light.id, grab: { x: light.x - p.x, y: light.y - p.y }, wasSelected }
    } else if (target?.kind === 'resize' && scene?.map) {
      const { map } = scene
      this.drag = { mode: 'resize', grab: { x: map.x + map.width - p.x, y: map.y + map.height - p.y } }
    } else if (target?.kind === 'view' && scene) {
      this.drag = { mode: 'view', grab: { x: scene.view.x - p.x, y: scene.view.y - p.y } }
    } else if (target?.kind === 'viewZoom' && scene) {
      const zoom = scene.viewZoom ?? 1
      this.drag = { mode: 'viewZoom', base: Math.hypot(p.x - scene.view.x, p.y - scene.view.y) * zoom }
    } else if (target?.kind === 'map' && scene?.map) {
      this.drag = { mode: 'map', grab: { x: scene.map.x - p.x, y: scene.map.y - p.y } }
    } else {
      this.drag = { mode: 'pan', last: this.toCanvas(e) }
    }
    this.app.canvas.style.cursor = this.drag.mode === 'pan' ? 'grabbing' : CURSORS[this.drag.mode]
    this.app.canvas.setPointerCapture(e.pointerId)
  }

  private onPointerMove = (e: PointerEvent) => {
    const drag = this.drag
    if (this.active) {
      const p = this.toScene(e)
      this.pointer = p
      this.active.move(this.toolView, p, e, this.toolPressed)
      this.drawTool()
      if (this.toolPressed) return
    }
    if (!drag) {
      const target = this.targetAt(this.toScene(e))
      this.app.canvas.style.cursor = this.copying(e, target) ? 'copy' : this.cursorFor(target)
      return
    }
    if (drag.mode === 'pan') {
      const c = this.toCanvas(e)
      this.requestRender()
      this.camera.position.x += c.x - drag.last.x
      this.camera.position.y += c.y - drag.last.y
      drag.last = c
      return
    }

    const p = this.toScene(e)
    if (drag.mode === 'box') {
      drag.end = p
      this.drawSelectionBox()
      return
    }
    if (drag.mode === 'wallPoint') {
      this.handlers.onWallPointDrag(drag.refs, drag.ref, wallPointAt(this.toolView, p, drag.refs))
      return
    }
    if (drag.mode === 'object' || drag.mode === 'objectResize' || drag.mode === 'objectRotate') {
      const o = this.state?.scene.objects.find((x) => x.id === drag.id)
      if (!o) return
      if (drag.mode === 'object' && (drag.group.length > 1 || this.selectedLightIds.size > 0)) {
        this.handlers.onObjectsMove(drag.group, p.x - drag.last.x, p.y - drag.last.y)
        drag.last = p
      } else if (drag.mode === 'object') {
        this.handlers.onObjectChange(o.id, { x: p.x + drag.grab.x, y: p.y + drag.grab.y })
      } else if (drag.mode === 'objectResize') {
        const k = Math.max(0.02, Math.hypot(p.x - o.x, p.y - o.y) / drag.startDist)
        const min = (this.state?.scene.grid.size ?? 100) * 0.1
        const kk = Math.max(k, min / Math.min(drag.startW, drag.startH))
        this.handlers.onObjectChange(o.id, { width: drag.startW * kk, height: drag.startH * kk })
      } else {
        let rotation = Math.atan2(p.y - o.y, p.x - o.x) + Math.PI / 2
        if (e.shiftKey) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12)
        this.handlers.onObjectChange(o.id, { rotation: ((rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) })
      }
      return
    }
    if (drag.mode === 'viewZoom') {
      const view = this.state?.scene.view
      if (view) this.handlers.onViewZoom(drag.base / Math.max(1e-6, Math.hypot(p.x - view.x, p.y - view.y)))
      return
    }
    if (drag.mode === 'aim') {
      const light = this.state?.scene.lights.find((l) => l.id === drag.id)
      if (light) this.handlers.onLightAim(drag.id, Math.atan2(p.y - light.y, p.x - light.x))
      return
    }
    const to = { x: p.x + drag.grab.x, y: p.y + drag.grab.y }
    if (drag.mode === 'sound') {
      this.handlers.onSoundMove(drag.id, to)
    } else if (drag.mode === 'light') {
      if (!this.handlers.onLightMove(drag.id, to, e.altKey)) this.dropDrag(e)
    } else if (drag.mode === 'view') {
      if (!this.handlers.onViewMove(to, e.altKey)) this.dropDrag(e)
    } else if (drag.mode === 'map') {
      this.handlers.onMapMove(to)
    } else {
      const map = this.state?.scene.map
      if (map) this.handlers.onMapResize(Math.max(MIN_MAP_SCALE, mapScaleForCorner(map, to)))
    }
  }

  private onPointerUp = (e: PointerEvent) => {
    if (this.toolPressed) {
      this.toolPressed = false
      this.active?.up?.(this.toolView)
      if (this.app.canvas.hasPointerCapture(e.pointerId)) this.app.canvas.releasePointerCapture(e.pointerId)
      return
    }
    // A click (not a drag): on an already-selected light, select just it; on anything but
    // a light, deselect (Ctrl/Cmd keeps the selection, for adding to it).
    const c = this.toCanvas(e)
    const start = this.pressedAt
    const clicked = start && Math.hypot(c.x - start.x, c.y - start.y) < CLICK_PX
    const drag = this.drag
    const onSomething =
      drag && ['light', 'aim', 'wallPoint', 'box', 'object', 'objectResize', 'objectRotate'].includes(drag.mode)
    if (drag?.mode === 'box') {
      // Shift+click (no box drawn) on an object or light: in or out of the selection.
      const on = clicked ? this.targetAt(drag.start) : null
      if (on?.kind === 'object') this.handlers.onObjectToggle(on.id)
      else if (on?.kind === 'light') this.handlers.onLightToggle(on.id)
      else {
        const r = rectBetween(drag.start, drag.end)
        const scene = this.state?.scene
        const lights = (scene?.lights ?? []).filter((l) => inRect(l, r) && !this.ghostLightIds.has(l.id)).map((l) => l.id)
        const points = wallPointsIn(scene?.walls ?? [], r)
        const objects = (scene?.objects ?? []).filter((o) => inRect(o, r)).map((o) => o.id)
        this.handlers.onBoxSelect(lights, points, objects, e.ctrlKey || e.metaKey)
      }
      this.drag = null
      this.drawSelectionBox()
    } else if (clicked && drag?.mode === 'object' && drag.wasSelected && drag.group.length > 1) {
      // A click on one of a selection: just that one (a grouped one keeps its group, but Alt).
      if (!this.groupOf(drag.id, 'object') || e.altKey) this.handlers.onObjectSelect(drag.id)
    } else if (clicked && drag?.mode === 'light' && drag.wasSelected) {
      if (!this.groupOf(drag.id, 'light') || e.altKey) this.handlers.onLightSelect(drag.id)
    } else if (clicked && drag?.mode === 'wallPoint' && drag.wasSelected) {
      this.handlers.onWallPointSelect(drag.ref)
    } else if (clicked && drag && !onSomething && !e.ctrlKey && !e.metaKey) {
      this.handlers.onLightSelect(null) // clears the whole selection
    }
    if (drag?.mode === 'pan') this.reportCamera()
    this.pressedAt = null
    this.drag = null
    this.app.canvas.style.cursor = this.cursorFor(this.targetAt(this.toScene(e)))
    if (this.app.canvas.hasPointerCapture(e.pointerId)) {
      this.app.canvas.releasePointerCapture(e.pointerId)
    }
  }

  /** Let go of whatever is being dragged (vision safety refused a move). */
  private dropDrag(e: PointerEvent) {
    this.drag = null
    this.pressedAt = null
    this.app.canvas.style.cursor = this.cursorFor(this.targetAt(this.toScene(e)))
    if (this.app.canvas.hasPointerCapture(e.pointerId)) this.app.canvas.releasePointerCapture(e.pointerId)
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const c = this.toCanvas(e)
    const before = this.toScene(e)
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, this.camera.scale.x * Math.exp(-e.deltaY * 0.0015)),
    )
    this.camera.scale.set(zoom)
    this.camera.position.set(c.x - before.x * zoom, c.y - before.y * zoom)
    this.drawOverlay()
    this.reportCamera()
  }
}

function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }
}
