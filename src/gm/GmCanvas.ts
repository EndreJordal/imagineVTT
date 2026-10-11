import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import { PixiHost } from '../render/PixiHost'
import { SceneLayer } from '../render/SceneLayer'
import {
  mapScaleForCorner,
  pointInPolygon,
  sceneBounds,
  tableViewCorners,
  upMarker,
} from '../shared/geometry'
import { LIGHT_PRESETS, type Light, type LightKind } from '../shared/lights'
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
  /** The GM dragged the table view's marker; view is its new centre. */
  onViewMove(view: Point): void
  /** The GM dragged the map's corner handle; scale is relative to the image's natural size. */
  onMapResize(scale: number): void
  /** The GM dragged the map; position is its new top-left corner. */
  onMapMove(position: Point): void
  /** The GM dragged a light token; position is where that light should go. */
  onLightMove(id: string, position: Point): void
  /** The GM dragged a directional light's aim handle; angle in radians. */
  onLightAim(id: string, angle: number): void
  /** Select just this light, or none (null). */
  onLightSelect(id: string | null): void
  /** Ctrl/Cmd-click: add the light to the selection, or take it out. */
  onLightToggle(id: string): void
  /** In placement mode, the GM clicked the map here. Shift keeps placing more. */
  onPlaceLight(at: Point, keepPlacing: boolean): void
  onPlaceCancel(): void
}

/** GM-only state the canvas shows but doesn't own. */
export interface GmUi {
  /** Last known table size; stays set (drawn dimmed) when the table window is closed. */
  tableScreen: Size | null
  tableConnected: boolean
  selectedLightIds: string[]
  /** Light kind waiting to be placed with a click, if any. */
  placingLight: LightKind | null
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

/**
 * What the pointer is over, in priority order of grabbing. 'locked' is the resize handle of
 * a map locked to the grid.
 */
type Target =
  | { kind: 'aim' | 'light'; id: string }
  | { kind: 'view' | 'map' | 'resize' | 'locked' }
  | null

const CURSORS: Record<Drag['mode'] | 'locked', string> = {
  pan: 'grab',
  view: 'move',
  map: 'move',
  resize: 'nwse-resize',
  locked: 'not-allowed',
  light: 'move',
  aim: 'crosshair',
}

/** Directional lights get an aim handle. */
const isDirectional = (light: Light) => LIGHT_PRESETS[light.kind].shape !== 'radial'

interface Token {
  root: Container
  ring: Graphics
  icon: Sprite
}

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
  private selectedLightIds = new Set<string>()
  private placingLight: LightKind | null = null
  /** Where the current press started (canvas px), to tell clicks from drags. */
  private pressedAt: Point | null = null
  private state: TableState | null = null
  private tableScreen: Size | null = null
  private tableConnected = false
  private image: Blob | null = null
  private marker: Point[] | null = null
  private drag: Drag | null = null
  private fitted = false
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
      this.lightTokens,
      this.aimHandle,
    )
    this.app.stage.addChild(this.camera)
    void this.sceneLayer.setMapImage(this.image)

    const canvas = this.app.canvas
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    this.app.ticker.add(() => this.sceneLayer.animate(this.app.renderer, performance.now() / 1000))
    this.render()
  }

  update(state: TableState, ui: GmUi) {
    this.state = state
    this.tableScreen = ui.tableScreen
    this.tableConnected = ui.tableConnected
    this.selectedLightIds = new Set(ui.selectedLightIds)
    if (ui.placingLight !== this.placingLight) {
      this.placingLight = ui.placingLight
      if (this.ready) this.app.canvas.style.cursor = this.cursorFor(null)
    }
    this.render()
  }

  setMapImage(image: Blob | null) {
    if (image === this.image) return
    this.image = image
    this.fitted = false
    if (this.ready) void this.sceneLayer.setMapImage(image)
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
  }

  /** Scene-space point at the centre of the GM view. */
  centre(): Point | null {
    if (!this.ready) return null
    const p = this.camera.toLocal({ x: this.app.screen.width / 2, y: this.app.screen.height / 2 })
    return { x: p.x, y: p.y }
  }

  private render() {
    if (!this.ready || !this.state) return
    this.sceneLayer.update(this.state.scene)
    if (!this.fitted) {
      this.fitted = true
      this.fit()
    }
    this.drawOverlay()
  }

  /** One GM screen pixel in scene units. */
  private get px() {
    return 1 / this.camera.scale.x
  }

  private drawOverlay() {
    this.drawMapHandle()
    this.drawLights()
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
      t.root.alpha = light.on ? 1 : 0.55
      t.icon.texture = iconTexture(LIGHT_PRESETS[light.kind].icon)
      t.icon.setSize(ICON_PX)
      t.ring
        .clear()
        .circle(0, 0, TOKEN_PX)
        .fill({ color: 0x1d1d22, alpha: 0.85 })
        .stroke({ width: 2.5, color: light.color })
      if (selected) t.ring.circle(0, 0, TOKEN_PX + 3.5).stroke({ width: 2, color: 0xffffff })
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
    // Placement mode: left-click places, right-click cancels; middle still pans.
    if (this.placingLight && e.button !== 1) {
      if (e.button === 0) this.handlers.onPlaceLight(p, e.shiftKey)
      else this.handlers.onPlaceCancel()
      return
    }
    const target = e.button === 0 ? this.targetAt(p) : null
    const scene = this.state?.scene
    if (target?.kind === 'locked') return // the resize handle is disabled while locked to the grid
    this.pressedAt = this.toCanvas(e)

    if (target?.kind === 'aim') {
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
    if (!drag) {
      this.app.canvas.style.cursor = this.cursorFor(this.targetAt(this.toScene(e)))
      return
    }
    if (drag.mode === 'pan') {
      const c = this.toCanvas(e)
      this.camera.position.x += c.x - drag.last.x
      this.camera.position.y += c.y - drag.last.y
      drag.last = c
      return
    }

    const p = this.toScene(e)
    if (drag.mode === 'aim') {
      const light = this.state?.scene.lights.find((l) => l.id === drag.id)
      if (light) this.handlers.onLightAim(drag.id, Math.atan2(p.y - light.y, p.x - light.x))
      return
    }
    const to = { x: p.x + drag.grab.x, y: p.y + drag.grab.y }
    if (drag.mode === 'light') {
      this.handlers.onLightMove(drag.id, to)
    } else if (drag.mode === 'view') {
      this.handlers.onViewMove(to)
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
    if (clicked && drag?.mode === 'light' && drag.wasSelected) {
      this.handlers.onLightSelect(drag.id)
    } else if (clicked && drag && drag.mode !== 'light' && drag.mode !== 'aim' && !e.ctrlKey && !e.metaKey) {
      this.handlers.onLightSelect(null)
    }
    this.pressedAt = null
    this.drag = null
    this.app.canvas.style.cursor = this.cursorFor(this.targetAt(this.toScene(e)))
    if (this.app.canvas.hasPointerCapture(e.pointerId)) {
      this.app.canvas.releasePointerCapture(e.pointerId)
    }
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
  }
}

function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }
}
