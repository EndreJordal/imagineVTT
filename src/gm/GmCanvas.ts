import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { PixiHost } from '../render/PixiHost'
import { SceneLayer } from '../render/SceneLayer'
import {
  mapScaleForCorner,
  snapToGrid,
  pointInPolygon,
  sceneBounds,
  tableViewCorners,
  upMarker,
} from '../shared/geometry'
import { emitsLight, isDirectional, LIGHT_PRESETS, type Light, type LightKind } from '../shared/lights'
import type { FogMemory } from '../shared/fog'
import { hitsObject, objectCorners, type AssetImages, type MapObject } from '../shared/mapObjects'
import type { GmCamera } from '../shared/sceneFile'
import {
  inRect,
  nearestOnSegment,
  rectBetween,
  sameSpot,
  sameRef,
  uniquePositions,
  wallPointsIn,
  withLinked,
  type WallPointRef,
} from '../shared/walls'
import type { Point, Size, TableState } from '../shared/types'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const VIEW_COLOR = 0xffb020
const HANDLE_COLOR = 0x4da3ff
const LOCKED_COLOR = 0x8a8a94
/** Map resize handle half-size, in GM screen pixels (larger when locked, to fit a padlock). */
const HANDLE_PX = 7
const LOCKED_HANDLE_PX = 10
/** Table-view "up" marker size (the drag handle for the view), in GM screen pixels. */
const MARKER_PX = 20
/** Extra grab radius around handles, in GM screen pixels. */
const SLACK_PX = 5
/** Smallest map scale the resize handle allows. */
const MIN_MAP_SCALE = 0.05
/** Light token radius, and how far out a directional light's aim handle sits, in GM screen px. */
const TOKEN_PX = 15
const AIM_PX = 44
const AIM_HANDLE_PX = 6
/** Pointer travel (screen px) below which a press counts as a click, not a drag. */
const CLICK_PX = 4

interface Handlers {
  /**
   * The GM dragged the table view's marker; view is its new centre. `force` (Alt held)
   * skips vision safety. Returning false refuses the move and drops the drag.
   */
  onViewMove(view: Point, force: boolean): boolean
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
  onObjectChange(id: string, patch: Partial<Pick<MapObject, 'x' | 'y' | 'width' | 'height' | 'rotation'>>): void
  /** Shift-drag box selection; `add` keeps what was already selected (Ctrl/Cmd). */
  onBoxSelect(lightIds: string[], wallPoints: WallPointRef[], add: boolean): void
  /** The GM panned or zoomed (or the view was fitted). */
  onCameraChange(camera: GmCamera): void
}

/** GM-only state the canvas shows but doesn't own. */
export interface GmUi {
  /** Last known table size; stays set (drawn dimmed) when the table window is closed. */
  tableScreen: Size | null
  tableConnected: boolean
  selectedLightIds: string[]
  /** Light kind waiting to be placed with a click, if any. */
  placingLight: LightKind | null
  /** Showing the GM exactly what the players see (fog of war included). */
  peeking: boolean
  /** Wall building mode: clicks add snapped wall points. */
  buildingWalls: boolean
  /** Snap fraction of a square for walls, doors and placing lights (0 = none). */
  snap: number
  /** Points of the wall being drawn. */
  wallDraft: Point[]
  selectedWallPoints: WallPointRef[]
  selectedObjectIds: string[]
  /** Door building mode: two clicks on a wall line make a door. */
  buildingDoors: boolean
  /** First point of the door being placed. */
  doorDraft: Point | null
}

type Drag =
  | { mode: 'pan'; last: Point }
  // grab = offset from the pointer to the thing being dragged, in scene space
  | { mode: 'view'; grab: Point }
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
  | { mode: 'object'; id: string; grab: Point }
  // Resizing scales about the centre, keeping the shape: by the pointer's distance from it.
  | { mode: 'objectResize'; id: string; startDist: number; startW: number; startH: number }
  | { mode: 'objectRotate'; id: string }

/**
 * What the pointer is over, in priority order of grabbing. 'locked' is the resize handle of
 * a map locked to the grid.
 */
type Target =
  | { kind: 'door' | 'aim' | 'light' | 'object' | 'objectResize' | 'objectRotate'; id: string }
  | { kind: 'wallPoint'; ref: WallPointRef }
  | { kind: 'view' | 'map' | 'resize' | 'locked' }
  | null

const CURSORS: Record<Drag['mode'] | 'locked' | 'door', string> = {
  pan: 'grab',
  view: 'move',
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

const WALL_COLOR = 0xff3344
/** Wall line width and point dot radius, in GM screen px. */
const WALL_PX = 3
const WALL_DOT_PX = 3.5
/** The snap marker under the cursor while building walls, in GM screen px. */
const SNAP_MARKER_PX = 6
const DOOR_COLOR = 0x33ff66
const OBJECT_COLOR = 0x4da3ff
/** Selected object's corner handles (half-size) and rotation handle (radius, distance out), GM px. */
const OBJECT_HANDLE_PX = 5
const ROTATE_HANDLE_PX = 6
const ROTATE_OUT_PX = 26
/** A door's open/close button (in its middle), radius in GM screen px. */
const DOOR_BUTTON_PX = 10
/** How far from a wall line (GM screen px) the door tool still finds a door point. */
const DOOR_REACH_PX = 22

/** CSS cursor showing a light's icon, with the hotspot in its centre. */
const iconCursors = new Map<string, string>()

function iconCursor(icon: string): string {
  let cursor = iconCursors.get(icon)
  if (!cursor) {
    const size = 32
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.font = '24px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = 3
    ctx.fillText(icon, size / 2, size / 2 + 1)
    cursor = `url(${canvas.toDataURL()}) ${size / 2} ${size / 2}, crosshair`
    iconCursors.set(icon, cursor)
  }
  return cursor
}

/** Emoji drawn once per icon and shared by every token showing it. */
const iconTextures = new Map<string, Texture>()
const ICON_PX = 18

function iconTexture(icon: string): Texture {
  let texture = iconTextures.get(icon)
  if (!texture) {
    const scale = 3 // stays crisp when the browser zooms or on HiDPI screens
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = ICON_PX * scale + 4
    const ctx = canvas.getContext('2d')!
    ctx.font = `${ICON_PX * scale * 0.8}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(icon, canvas.width / 2, canvas.height / 2 + scale)
    texture = Texture.from(canvas)
    iconTextures.set(icon, texture)
  }
  return texture
}

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
  private tokens = new Map<string, Token>()
  private aimHandle = new Graphics()
  /** Faint rings showing how far the selected vision tokens see. */
  private visionRings = new Graphics()
  /** Walls (GM-only: players only see their effect on sight). */
  private wallsLayer = new Graphics()
  /** Outline and handles of the selected objects. */
  private objectHandles = new Graphics()
  private selectedObjectIds = new Set<string>()
  /** The wall being drawn, its preview segment and the snap marker. */
  private wallDraftLayer = new Graphics()
  private buildingWalls = false
  private snap = 1
  private wallDraft: Point[] = []
  private selectedWallPoints: WallPointRef[] = []
  /** The Shift-drag selection box. */
  private selectionBox = new Graphics()
  /** Snapped point under the cursor while building walls. */
  private wallCursor: Point | null = null
  private buildingDoors = false
  private doorDraft: Point | null = null
  /** Valid door point under the cursor while building doors (null: none in reach). */
  private doorCursor: Point | null = null
  /** Where a light being placed would go (snapped), while placing. */
  private lightCursor: Point | null = null
  private selectedLightIds = new Set<string>()
  private placingLight: LightKind | null = null
  private peeking = false
  private fogMemory: FogMemory | null = null
  private fogVersion = -1
  /** Where the current press started (canvas px), to tell clicks from drags. */
  private pressedAt: Point | null = null
  private state: TableState | null = null
  private tableScreen: Size | null = null
  private tableConnected = false
  private image: Blob | null = null
  private marker: Point[] | null = null
  private drag: Drag | null = null
  private fitted = false
  /** A camera to show instead of fitting the map, once the canvas is ready. */
  private pendingCamera: GmCamera | null = null
  private handlers: Handlers

  constructor(host: HTMLElement, handlers: Handlers) {
    super(host, '#141417')
    this.handlers = handlers
  }

  protected setup() {
    this.camera.addChild(
      this.sceneLayer,
      this.viewOverlay,
      this.mapHandle,
      this.viewMarker,
      this.objectHandles,
      this.wallsLayer,
      this.visionRings,
      this.lightTokens,
      this.aimHandle,
      this.wallDraftLayer,
      this.selectionBox,
    )
    this.app.stage.addChild(this.camera)
    this.sceneLayer.onChange = () => this.requestRender()
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
    this.state = state
    this.tableScreen = ui.tableScreen
    this.tableConnected = ui.tableConnected
    this.selectedLightIds = new Set(ui.selectedLightIds)
    this.peeking = ui.peeking
    this.snap = ui.snap
    this.wallDraft = ui.wallDraft
    this.selectedWallPoints = ui.selectedWallPoints
    this.selectedObjectIds = new Set(ui.selectedObjectIds)
    this.doorDraft = ui.doorDraft
    if (
      ui.placingLight !== this.placingLight ||
      ui.buildingWalls !== this.buildingWalls ||
      ui.buildingDoors !== this.buildingDoors
    ) {
      this.placingLight = ui.placingLight
      this.buildingWalls = ui.buildingWalls
      this.buildingDoors = ui.buildingDoors
      if (!this.buildingWalls) this.wallCursor = null
      if (!this.buildingDoors) this.doorCursor = null
      if (!this.placingLight) this.lightCursor = null
      if (this.ready) this.app.canvas.style.cursor = this.cursorFor(null)
    }
    this.render()
  }

  /** Fog memory changed (the grid object is updated in place; version tells when). */
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
    this.sceneLayer.update(this.state.scene, this.peeking ? 'players' : 'gm')
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
    this.drawWalls()
    this.drawObjectHandles()
    const g = this.viewOverlay.clear()
    this.viewMarker.clear()
    this.marker = null
    if (!this.state || !this.tableScreen) return

    const px = this.px
    const corners = tableViewCorners(this.state.scene, this.state.display, this.tableScreen)
    this.viewOverlay.alpha = this.tableConnected ? 1 : 0.5

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
    g.poly(corners).stroke({ width: 2 * px, color: VIEW_COLOR })

    // The marker on the table's "up" edge doubles as the handle for moving the view.
    this.marker = upMarker(corners, this.state.scene.view, MARKER_PX * px)
    this.viewMarker
      .poly(this.marker)
      .fill(VIEW_COLOR)
      .stroke({ width: 2 * px, color: 0x000000, alpha: 0.8 })
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
      // Dimmed when switched off: lights by being unlit, vision tokens by not seeing.
      t.root.alpha = (emitsLight(light) ? light.on : light.vision) ? 1 : 0.55
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
    const g = this.wallsLayer.clear()
    const walls = this.state?.scene.walls ?? []
    for (const wall of walls) {
      const color = wall.door ? DOOR_COLOR : WALL_COLOR
      const alpha = wall.door?.open ? 0.4 : 1
      g.poly(wall.points, false).stroke({ width: WALL_PX * px, color, alpha, join: 'round', cap: 'round' })
    }
    // Linked points (same spot) are one point: one dot, one ring. Green where a door ends.
    const doorEnds = walls.filter((w) => w.door).flatMap((w) => w.points)
    for (const p of uniquePositions(walls.flatMap((w) => w.points))) {
      const isDoor = doorEnds.some((q) => sameSpot(p, q))
      g.circle(p.x, p.y, WALL_DOT_PX * px).fill(isDoor ? DOOR_COLOR : WALL_COLOR)
    }
    for (const wall of walls) {
      if (!wall.door) continue
      const c = doorButton(wall.points)
      const r = DOOR_BUTTON_PX * px
      g.circle(c.x, c.y, r).fill({ color: 0x1d1d22, alpha: 0.9 }).stroke({ width: 2 * px, color: DOOR_COLOR })
      // A door leaf: solid when closed, an outline when open.
      const leaf = g.roundRect(c.x - 3.5 * px, c.y - 5.5 * px, 7 * px, 11 * px, 1 * px)
      if (wall.door.open) leaf.stroke({ width: 1.5 * px, color: DOOR_COLOR })
      else leaf.fill(DOOR_COLOR)
    }
    const selected = this.selectedWallPoints.map((r) => this.wallPoint(r)).filter((p) => !!p)
    for (const p of uniquePositions(selected)) {
      g.circle(p.x, p.y, (WALL_DOT_PX + 3) * px).stroke({ width: 2 * px, color: 0xffffff })
    }
    this.drawWallDraft()
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

  private drawWallDraft() {
    this.requestRender()
    const px = this.px
    const g = this.wallDraftLayer.clear()
    if (this.placingLight && this.lightCursor && this.snap > 0) {
      const c = this.lightCursor
      g.circle(c.x, c.y, (TOKEN_PX + 2) * px).stroke({ width: 2 * px, color: 0xffffff, alpha: 0.8 })
      return
    }
    if (this.buildingDoors) {
      const first = this.doorDraft
      const cursor = this.doorCursor
      if (first && cursor) {
        g.moveTo(first.x, first.y)
          .lineTo(cursor.x, cursor.y)
          .stroke({ width: WALL_PX * px, color: DOOR_COLOR, alpha: 0.6, cap: 'round' })
      }
      if (first) g.circle(first.x, first.y, WALL_DOT_PX * 1.5 * px).fill(DOOR_COLOR)
      if (cursor) {
        g.circle(cursor.x, cursor.y, SNAP_MARKER_PX * px)
          .fill({ color: DOOR_COLOR, alpha: 0.85 })
          .stroke({ width: 1.5 * px, color: 0xffffff })
      }
      return
    }
    if (!this.buildingWalls) return
    const draft = this.wallDraft
    const cursor = this.wallCursor
    if (draft.length > 1) {
      g.poly(draft, false).stroke({ width: WALL_PX * px, color: WALL_COLOR, join: 'round', cap: 'round' })
    }
    // Preview of the next segment, from the last point to the snapped cursor.
    const last = draft.at(-1)
    if (last && cursor) {
      g.moveTo(last.x, last.y)
        .lineTo(cursor.x, cursor.y)
        .stroke({ width: WALL_PX * px, color: WALL_COLOR, alpha: 0.6, cap: 'round' })
    }
    for (const p of draft) g.circle(p.x, p.y, WALL_DOT_PX * px).fill(WALL_COLOR)
    if (cursor) {
      g.circle(cursor.x, cursor.y, SNAP_MARKER_PX * px)
        .fill({ color: WALL_COLOR, alpha: 0.85 })
        .stroke({ width: 1.5 * px, color: 0xffffff })
    }
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

  /**
   * Where a wall point would go for pointer position p: onto an existing wall point under the
   * pointer (so walls join exactly, even without grid snap), else the nearest grid snap point.
   * `moving` points are skipped, so a dragged point doesn't snap onto itself.
   */
  private wallPointAt(p: Point, moving: WallPointRef[] = []): Point {
    let best: Point | undefined
    let bestDist = (WALL_DOT_PX + SLACK_PX) * this.px
    const consider = (q: Point) => {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d <= bestDist) {
        best = q
        bestDist = d
      }
    }
    for (const w of this.state?.scene.walls ?? []) {
      w.points.forEach((q, index) => {
        if (!moving.some((r) => r.wallId === w.id && r.index === index)) consider(q)
      })
    }
    for (const q of this.wallDraft) consider(q)
    if (best) return { x: best.x, y: best.y }
    const grid = this.state?.scene.grid
    return grid ? snapToGrid(p, grid, this.snap) : p
  }

  /**
   * The door point the door tool would use for pointer position p, or null: an existing wall
   * point under the pointer, else the nearest snap point lying on a wall line (with snapping
   * off, the nearest spot on the line). Doors themselves aren't wall lines to put doors in.
   */
  private doorPointAt(p: Point): Point | null {
    const state = this.state
    if (!state) return null
    const px = this.px
    for (const w of state.scene.walls) {
      for (const q of w.points) {
        if (Math.hypot(p.x - q.x, p.y - q.y) <= (WALL_DOT_PX + SLACK_PX) * px) return { x: q.x, y: q.y }
      }
    }
    const { grid } = state.scene
    const step = grid.size * this.snap
    let best: Point | null = null
    let bestDist = DOOR_REACH_PX * px
    const consider = (q: Point) => {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d <= bestDist) {
        best = q
        bestDist = d
      }
    }
    for (const w of state.scene.walls) {
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
        const centre = snapToGrid(near.point, grid, this.snap)
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
  private lightPointAt(p: Point): Point {
    const grid = this.state?.scene.grid
    return grid ? snapToGrid(p, grid, this.snap) : p
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
      const c = doorButton(w.points)
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
      if (Math.hypot(p.x - l.x, p.y - l.y) <= (TOKEN_PX + 2) * px) return { kind: 'light', id: l.id }
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
    if (this.placingLight) return iconCursor(LIGHT_PRESETS[this.placingLight].icon)
    if (this.buildingWalls) return iconCursor('🧱')
    if (this.buildingDoors) return target?.kind === 'door' ? CURSORS.door : iconCursor('🚪')
    return CURSORS[target?.kind ?? 'pan']
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
    if ((this.buildingWalls || this.buildingDoors || this.placingLight) && e.button === 2) {
      this.handlers.onToolConfirm()
      return
    }
    // Wall building: left-click adds a snapped point.
    if (this.buildingWalls && e.button === 0) {
      this.handlers.onWallPoint(this.wallPointAt(p))
      return
    }
    // Door building: left-click toggles a door's button or places a door point.
    if (this.buildingDoors && e.button === 0) {
      const target = this.targetAt(p)
      if (target?.kind === 'door') {
        this.handlers.onDoorToggle(target.id)
        return
      }
      const at = this.doorPointAt(p)
      if (at) this.handlers.onDoorPoint(at)
      return
    }
    // Placement mode: left-click places.
    if (this.placingLight && e.button === 0) {
      this.handlers.onPlaceLight(this.lightPointAt(p), e.shiftKey)
      return
    }
    const target = e.button === 0 ? this.targetAt(p) : null
    const scene = this.state?.scene
    if (target?.kind === 'locked') return // the resize handle is disabled while locked to the grid
    if (target?.kind === 'door') {
      this.handlers.onDoorToggle(target.id)
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
      const wasSelected = this.selectedWallPoints.some((r) => sameRef(r, target.ref))
      if (!wasSelected) this.handlers.onWallPointSelect(target.ref)
      const refs = e.altKey
        ? [target.ref]
        : withLinked(walls, wasSelected ? this.selectedWallPoints : [target.ref])
      this.drag = { mode: 'wallPoint', ref: target.ref, refs, wasSelected }
    } else if (target?.kind === 'object') {
      const o = scene?.objects.find((x) => x.id === target.id)
      if (!o) return
      if (!this.selectedObjectIds.has(o.id)) this.handlers.onObjectSelect(o.id)
      this.drag = { mode: 'object', id: o.id, grab: { x: o.x - p.x, y: o.y - p.y } }
    } else if (target?.kind === 'objectResize') {
      const o = scene?.objects.find((x) => x.id === target.id)
      if (!o) return
      const startDist = Math.max(1e-6, Math.hypot(p.x - o.x, p.y - o.y))
      this.drag = { mode: 'objectResize', id: o.id, startDist, startW: o.width, startH: o.height }
    } else if (target?.kind === 'objectRotate') {
      this.drag = { mode: 'objectRotate', id: target.id }
    } else if (target?.kind === 'aim') {
      this.drag = { mode: 'aim', id: target.id }
    } else if (target?.kind === 'light') {
      const light = scene?.lights.find((l) => l.id === target.id)
      if (!light) return
      if (e.ctrlKey || e.metaKey) {
        this.handlers.onLightToggle(light.id)
        this.pressedAt = null
        return
      }
      const wasSelected = this.selectedLightIds.has(light.id)
      if (!wasSelected) this.handlers.onLightSelect(light.id)
      this.drag = { mode: 'light', id: light.id, grab: { x: light.x - p.x, y: light.y - p.y }, wasSelected }
    } else if (target?.kind === 'resize' && scene?.map) {
      const { map } = scene
      this.drag = { mode: 'resize', grab: { x: map.x + map.width - p.x, y: map.y + map.height - p.y } }
    } else if (target?.kind === 'view' && scene) {
      this.drag = { mode: 'view', grab: { x: scene.view.x - p.x, y: scene.view.y - p.y } }
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
    if (this.buildingWalls) {
      this.wallCursor = this.wallPointAt(this.toScene(e))
      this.drawWallDraft()
    }
    if (this.buildingDoors) {
      this.doorCursor = this.doorPointAt(this.toScene(e))
      this.drawWallDraft()
    }
    if (this.placingLight) {
      this.lightCursor = this.lightPointAt(this.toScene(e))
      this.drawWallDraft()
    }
    if (!drag) {
      this.app.canvas.style.cursor = this.cursorFor(this.targetAt(this.toScene(e)))
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
      this.handlers.onWallPointDrag(drag.refs, drag.ref, this.wallPointAt(p, drag.refs))
      return
    }
    if (drag.mode === 'object' || drag.mode === 'objectResize' || drag.mode === 'objectRotate') {
      const o = this.state?.scene.objects.find((x) => x.id === drag.id)
      if (!o) return
      if (drag.mode === 'object') {
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
    if (drag.mode === 'aim') {
      const light = this.state?.scene.lights.find((l) => l.id === drag.id)
      if (light) this.handlers.onLightAim(drag.id, Math.atan2(p.y - light.y, p.x - light.x))
      return
    }
    const to = { x: p.x + drag.grab.x, y: p.y + drag.grab.y }
    if (drag.mode === 'light') {
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
    // A click (not a drag): on an already-selected light, select just it; on anything but
    // a light, deselect (Ctrl/Cmd keeps the selection, for adding to it).
    const c = this.toCanvas(e)
    const start = this.pressedAt
    const clicked = start && Math.hypot(c.x - start.x, c.y - start.y) < CLICK_PX
    const drag = this.drag
    const onSomething =
      drag && ['light', 'aim', 'wallPoint', 'box', 'object', 'objectResize', 'objectRotate'].includes(drag.mode)
    if (drag?.mode === 'box') {
      const r = rectBetween(drag.start, drag.end)
      const lights = (this.state?.scene.lights ?? []).filter((l) => inRect(l, r)).map((l) => l.id)
      const points = wallPointsIn(this.state?.scene.walls ?? [], r)
      this.handlers.onBoxSelect(lights, points, e.ctrlKey || e.metaKey)
      this.drag = null
      this.drawSelectionBox()
    } else if (clicked && drag?.mode === 'light' && drag.wasSelected) {
      this.handlers.onLightSelect(drag.id)
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

/** Where a door's open/close button sits: the middle of the door. */
function doorButton(points: Point[]): Point {
  const a = points[0]
  const b = points.at(-1)!
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }
}
