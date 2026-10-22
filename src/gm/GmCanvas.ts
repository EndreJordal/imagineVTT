import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { PixiHost } from '../render/PixiHost'
import { iconCursor, loadCanvasIcons } from './canvasIcons'
import { SceneLayer } from '../render/SceneLayer'
import {
  mapScaleForCorner,
  pointInPolygon,
  sceneBounds,
  tableViewCorners,
  upMarker,
} from '../shared/geometry'
import type { FogMemory } from '../shared/fog'
import { hitsObject, type AssetImages, type MapObject } from '../shared/mapObjects'
import { snapToken, tokenDiameter } from '../shared/characters'
import type { GmCamera } from '../shared/sceneFile'
import {
  inRect,
  rectBetween,
  sameRef,
  wallPointsIn,
  withLinked,
} from '../shared/walls'
import type { Point, Scene, TableState } from '../shared/types'
import { handoutBox } from '../shared/handout'
import { createTool, wallPointAt, type CanvasTool, type ToolCanvas } from './canvasTools'
import { SLACK_PX } from './canvasStyle'
import { SELECT } from './tools'
import { NOTHING_SELECTED } from './slices/shared'
import { hitsMeasure } from '../shared/measure'
import { waterCentre } from '../shared/water'
import { CURSORS, type Drag, type GmUi, type Handlers, type Target } from './canvasTypes'
import { MapHandle } from './canvasMap'
import { LightTokens } from './canvasLights'
import { HiddenTokens, SoundTokens, WaterTokens } from './canvasTokens'
import { WallsLayer } from './canvasWalls'
import { ObjectHandles } from './canvasObjects'

const MIN_ZOOM = 0.05
const MAX_ZOOM = 8
const VIEW_COLOR = 0xffb020
/** The outline of the picture shown to the players. */
const HANDOUT_COLOR = 0xd8c9a3
/** Half the size of the table view's corner handles, in GM screen px. */
const VIEW_CORNER_PX = 5
/** The table view's outline while the curtain is down (the players see a picture, not the map). */
const CURTAIN_COLOR = 0xd94dff
/** Table-view "up" marker size (the drag handle for the view), in GM screen pixels. */
const MARKER_PX = 20
/** Smallest map scale the resize handle allows. */
const MIN_MAP_SCALE = 0.05
/** Pointer travel (screen px) below which a press counts as a click, not a drag. */
const CLICK_PX = 4

export { UI_KEYS, type GmUi, type Handlers } from './canvasTypes'

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
  private mapHandle = new MapHandle()
  /** Drawn separately so the drag handle stays fully opaque while the view is dimmed. */
  private viewMarker = new Graphics()
  private lights = new LightTokens()
  private hidden = new HiddenTokens()
  private water = new WaterTokens()
  private sounds = new SoundTokens()
  private walls = new WallsLayer()
  /** Onion skin: another floor's map, faint, to line this one up with it. */
  private onionSprite = new Sprite({ alpha: 0.3 })
  private onionImage: Blob | null = null
  private onion: GmUi['onion'] = null
  private onionToken = 0
  /** Outline and handles of the selected objects. */
  private objectHandles = new ObjectHandles()
  private selectedObjectIds = new Set<string>()
  /** What the tool in hand draws: the wall or door being drawn, snap markers, the brush. */
  private toolLayer = new Graphics()
  /** The Shift-drag selection box. */
  private selectionBox = new Graphics()
  /** Where a dragged character token will go. */
  private characterGhost = new Graphics()
  /** How far the acting combatant's token has moved this turn, under the token (GM-only). */
  private turnLabel = new Text({
    text: '',
    anchor: { x: 0.5, y: 0 },
    style: { fill: 0xffe2a0, fontFamily: 'system-ui, sans-serif', fontSize: 15, fontWeight: 'bold', stroke: { color: 0x000000, width: 4 } },
  })
  /** How many squares the dragged token moves (diagonals count 1, like straight moves). */
  private ghostLabel = new Text({
    text: '',
    anchor: 0.5,
    style: { fill: 0xffffff, fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: 'bold', stroke: { color: 0x000000, width: 5 } },
  })
  private ui: GmUi = {
    tableScreen: { width: 1920, height: 1080 },
    tableConnected: false,
    ...NOTHING_SELECTED,
    tool: SELECT,
    peeking: false,
    snap: 1,
    wallDraft: [],
    doorDraft: null,
    hideBrush: 1,
    waterBrush: 1,
    selectedWaterIds: [],
    onion: null,
    curtainDown: false,
    handout: null,
    ghostLightIds: [],
    turnMove: null,
    alerting: false,
    lastAlert: null,
    measureDraft: null,
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
  /** Where the drag started, in scene units (a mixed selection's tokens move by the whole drag). */
  private dragFrom: Point = { x: 0, y: 0 }
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
      waterBrush: () => this.ui.waterBrush,
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
      this.mapHandle.g,
      this.viewMarker,
      this.objectHandles.g,
      this.walls.g,
      this.lights.rings,
      this.hidden.layer,
      this.water.layer,
      this.sounds.range,
      this.sounds.layer,
      this.lights.layer,
      this.lights.aim,
      this.selectionBox,
      this.characterGhost,
      this.turnLabel,
      this.ghostLabel,
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
    if (ui.lastAlert && ui.lastAlert !== was.lastAlert && state.scene) {
      this.sceneLayer.alert(ui.lastAlert.at, state.scene.grid.size)
    }
    if (ui.alerting !== was.alerting && this.ready) this.app.canvas.style.cursor = this.cursorFor(null)
    this.sceneLayer.measures.setDraft(ui.measureDraft)
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

  /** The combatant acting in the linked fight: its token glows (null: none). */
  setActiveCombatant(ref: string | null) {
    this.sceneLayer.characters.setActive(ref)
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
    this.sceneLayer.setTurnStart(this.turnStart())
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
    this.drawKinds()
    // Previewing (Preview, or V held): exactly what the players see, so none of the GM's marks.
    const marks = !this.ui.peeking
    for (const o of [
      this.lights.layer,
      this.lights.rings,
      this.lights.aim,
      this.hidden.layer,
      this.water.layer,
      this.sounds.layer,
      this.sounds.range,
      this.walls.g,
      this.objectHandles.g,
      this.mapHandle.g,
      this.selectionBox,
      this.characterGhost,
      this.ghostLabel,
      this.toolLayer,
    ]) {
      o.visible = marks
    }
    this.sceneLayer.characters.select(marks ? this.ui.selectedCharacterIds : [], this.px)
    this.drawTurnLabel()
    if (!marks) this.turnLabel.visible = false
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

    // The picture shown to the players, where it sits on the table.
    if (this.ui.handout) {
      const screen = this.ui.tableScreen
      const box = handoutBox(screen, this.ui.handout.size, this.ui.handout.turn, this.ui.handout.fill)
      // Screen point (u, v in 0..1) to scene: corners are the table's top-left, top-right,
      // bottom-right, bottom-left.
      const [c0, c1, , c3] = corners
      const at = (u: number, v: number) => ({
        x: c0.x + (c1.x - c0.x) * u + (c3.x - c0.x) * v,
        y: c0.y + (c1.y - c0.y) * u + (c3.y - c0.y) * v,
      })
      const u0 = 0.5 - box.width / screen.width / 2
      const v0 = 0.5 - box.height / screen.height / 2
      const outline = [at(u0, v0), at(1 - u0, v0), at(1 - u0, 1 - v0), at(u0, 1 - v0)]
      g.poly(outline).fill({ color: HANDOUT_COLOR, alpha: 0.18 }).stroke({ width: 2 * px, color: HANDOUT_COLOR })
    }

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

  private drawKinds() {
    if (!this.state) return
    const scene = this.state.scene
    const px = this.px
    this.mapHandle.draw(scene.map, px)
    this.lights.draw(scene, this.selectedLightIds, this.ghostLightIds, px)
    this.hidden.draw({ scene, ui: this.ui, px })
    this.water.draw({ scene, ui: this.ui, px })
    this.sounds.draw({ scene, ui: this.ui, px })
    this.walls.draw(scene.walls, px, this.ui.selectedWallPoints)
    this.drawTool()
    this.objectHandles.draw(this.selectedObjects(), px)
  }

  private selectedObjects(): MapObject[] {
    return (this.state?.scene.objects ?? []).filter((o) => this.selectedObjectIds.has(o.id))
  }

  /** The tool in hand's previews. */
  private drawTool() {
    this.requestRender()
    const g = this.toolLayer.clear()
    this.active?.draw(this.toolView, g)
  }

  /**
   * Faint tokens where the dragged ones will go (moved by dx, dy), and the way there; the
   * `leader` (the token dragged, else the first) shows how many squares it moves.
   */
  private drawCharacterGhosts(ids: string[], dx: number, dy: number, leader = ids[0]) {
    if (!this.state) return
    const scene = this.state.scene
    const px = this.px
    const g = this.characterGhost.clear()
    this.ghostLabel.visible = false
    for (const id of ids) {
      const t = scene.characters?.find((x) => x.id === id)
      if (!t) continue
      const r = tokenDiameter(t, scene) / 2
      const to = t.snap ? snapToken({ x: t.x + dx, y: t.y + dy }, t.size, scene.grid) : { x: t.x + dx, y: t.y + dy }
      g.moveTo(t.x, t.y)
        .lineTo(to.x, to.y)
        .stroke({ width: 2 * px, color: 0xffffff, alpha: 0.5 })
        .circle(to.x, to.y, r)
        .fill({ color: 0xffffff, alpha: 0.15 })
        .stroke({ width: 2 * px, color: 0xffffff, alpha: 0.9 })
      if (id === leader) {
        const squares = Math.round(Math.max(Math.abs(to.x - t.x), Math.abs(to.y - t.y)) / scene.grid.size)
        // The acting combatant: what the turn comes to with this move.
        const turn = this.ui.turnMove
        const total = turn && t.ref === turn.ref ? Math.round(turn.squares + squares) : null
        this.ghostLabel.text = total !== null ? `${squares} → ${total}` : String(squares)
        this.ghostLabel.position.set(to.x, to.y)
        this.ghostLabel.scale.set(px)
        this.ghostLabel.visible = squares > 0
      }
    }
    this.requestRender()
  }

  /** Where the acting combatant's token started its turn, if it has moved and is on this floor. */
  private turnStart() {
    const turn = this.ui.turnMove
    const scene = this.state?.scene
    const token = turn && scene?.characters?.find((t) => t.ref === turn.ref)
    return token && scene ? { ...turn.start, r: tokenDiameter(token, scene) / 2 } : null
  }

  /** "7 yd" under the acting combatant's token, once it has moved this turn. */
  private drawTurnLabel() {
    const turn = this.ui.turnMove
    const scene = this.state?.scene
    const token = turn && scene?.characters?.find((t) => t.ref === turn.ref)
    this.turnLabel.visible = !!token
    if (!token || !scene) return
    const px = this.px
    this.turnLabel.text = `${Math.round(turn.squares)} yd`
    this.turnLabel.scale.set(px)
    this.turnLabel.position.set(token.x, token.y + (token.size * scene.grid.size) / 2 + 2 * px)
  }

  private clearGhosts() {
    this.characterGhost.clear()
    this.ghostLabel.visible = false
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

  /** What a left-drag starting at p would grab, in priority order. */
  private targetAt(p: Point): Target {
    const state = this.state
    if (!state) return null
    const px = this.px
    const scene = state.scene
    const map = scene.map

    // Door buttons sit on top of everything, then the selected light's aim handle, then
    // tokens (topmost, last drawn, first), wall points, and the selected objects' handles.
    const hit =
      this.walls.doorAt(p, scene.walls, px) ??
      this.lights.hit(p, scene.lights, this.selectedLightIds, this.ghostLightIds, px) ??
      characterAt(p, scene) ??
      this.sounds.hit(p, scene.sounds ?? [], px) ??
      this.hidden.hit(p, scene, px) ??
      this.water.hit(p, scene, px) ??
      this.walls.pointAt(p, scene.walls, px) ??
      this.objectHandles.hit(p, this.selectedObjects(), px)
    if (hit) return hit
    const object = scene.objects.findLast((o) => hitsObject(o, p))
    if (object) return { kind: 'object', id: object.id }

    const handle = map && this.mapHandle.hit(p, map, px)
    if (handle) return handle
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
    const movable = map && !map.locked && !(map.lockX && map.lockY)
    if (movable && p.x >= map.x && p.x <= map.x + map.width && p.y >= map.y && p.y <= map.y + map.height) {
      return { kind: 'map' }
    }
    return null
  }

  private cursorFor(target: Target) {
    if (this.ui.alerting) return iconCursor('alert')
    if (this.active) return this.active.cursor(this.toolView, this.pointer)
    if (target?.kind === 'objectResize') return target.cursor
    return CURSORS[target?.kind ?? 'pan']
  }

  /** The group a light or object is in, if any. */
  private groupOf(id: string, kind: 'light' | 'object' | 'character') {
    const scene = this.state?.scene
    const list = kind === 'light' ? scene?.lights : kind === 'object' ? scene?.objects : scene?.characters
    return list?.find((x) => x.id === id)?.group
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
    // Alert mode: a click in the table view makes an alert; right-click leaves the mode.
    if (this.ui.alerting && e.button !== 1) {
      if (e.button === 2) this.handlers.onAlertOff()
      else if (this.viewCorners && pointInPolygon(p, this.viewCorners)) this.handlers.onAlert(p)
      return
    }
    // Right-click on a measurement removes it.
    if (e.button === 2) {
      const slack = (SLACK_PX + 4) * this.px
      const hit = this.state?.scene.measures?.findLast((m) => hitsMeasure(m, p, slack))
      if (hit) return this.handlers.onMeasureRemove(hit.id)
    }
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
    if (target?.kind === 'mapLock') {
      this.handlers.onMapLockToggle()
      return
    }
    if (target?.kind === 'door') {
      this.handlers.onDoorToggle(target.id)
      return
    }
    if (this.copying(e, target)) {
      this.handlers.onObjectCopy(p)
      return
    }
    this.pressedAt = this.toCanvas(e)
    this.dragFrom = p

    if (e.button === 0 && e.shiftKey && target?.kind !== 'objectResize') {
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
      this.drag = { mode: 'objectResize', id: o.id, startDist, startW: o.width, startH: o.height, cursor: target.cursor }
    } else if (target?.kind === 'objectRotate') {
      this.drag = { mode: 'objectRotate', id: target.id }
    } else if (target?.kind === 'aim') {
      this.drag = { mode: 'aim', id: target.id }
    } else if (target?.kind === 'character') {
      const t = scene?.characters?.find((x) => x.id === target.id)
      if (!t) return
      // Clicking a grouped token selects its group (Alt: just it); a selected one keeps the selection.
      const wasSelected = this.ui.selectedCharacterIds.includes(t.id)
      if (!wasSelected) {
        if (t.group && !e.altKey) this.handlers.onGroupSelect(t.group)
        else this.handlers.onCharacterSelect(t.id)
      }
      // The selection now (handlers update the canvas at once): all of it moves together.
      const ids = this.ui.selectedCharacterIds.includes(t.id) ? [...this.ui.selectedCharacterIds] : [t.id]
      this.drag = { mode: 'character', id: t.id, grab: { x: t.x - p.x, y: t.y - p.y }, to: null, ids, wasSelected }
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
    } else if (target?.kind === 'water') {
      // Grouped water selects its group (Alt: just it).
      const w = scene?.waterAreas?.find((x) => x.id === target.id)
      if (w?.group && !e.altKey) this.handlers.onGroupSelect(w.group)
      else this.handlers.onWaterSelect(target.id)
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
    this.app.canvas.style.cursor =
      this.drag.mode === 'pan' ? 'grabbing' : this.drag.mode === 'objectResize' ? this.drag.cursor : CURSORS[this.drag.mode]
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
    // Objects and lights move as they're dragged; selected tokens show where they'll slide to.
    if ((drag.mode === 'object' || drag.mode === 'light') && this.ui.selectedCharacterIds.length) {
      this.drawCharacterGhosts(this.ui.selectedCharacterIds, p.x - this.dragFrom.x, p.y - this.dragFrom.y)
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
        const min = (this.state?.scene.grid.size ?? 100) * 0.1
        if (e.shiftKey) {
          // Shift: squish, width and height each to the pointer (in the object's own axes).
          const dx = p.x - o.x
          const dy = p.y - o.y
          const c = Math.cos(o.rotation)
          const s = Math.sin(o.rotation)
          const width = Math.max(min, 2 * Math.abs(dx * c + dy * s))
          const height = Math.max(min, 2 * Math.abs(-dx * s + dy * c))
          this.handlers.onObjectChange(o.id, { width, height })
        } else {
          const k = Math.max(0.02, Math.hypot(p.x - o.x, p.y - o.y) / drag.startDist)
          const kk = Math.max(k, min / Math.min(drag.startW, drag.startH))
          this.handlers.onObjectChange(o.id, { width: drag.startW * kk, height: drag.startH * kk })
        }
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
    if (drag.mode === 'character') {
      const t = this.state?.scene.characters?.find((x) => x.id === drag.id)
      if (!t || !this.state) return
      drag.to = t.snap ? snapToken(to, t.size, this.state.scene.grid) : to
      this.drawCharacterGhosts(drag.ids, drag.to.x - t.x, drag.to.y - t.y, drag.id)
    } else if (drag.mode === 'sound') {
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
      drag &&
      ['light', 'aim', 'wallPoint', 'box', 'object', 'objectResize', 'objectRotate', 'sound', 'character'].includes(drag.mode)
    if (drag?.mode === 'box') {
      // Shift+click (no box drawn) on an object or light: in or out of the selection.
      const on = clicked ? this.targetAt(drag.start) : null
      if (on?.kind === 'object') this.handlers.onObjectToggle(on.id)
      else if (on?.kind === 'light') this.handlers.onLightToggle(on.id)
      else if (on?.kind === 'character') this.handlers.onCharacterToggle(on.id)
      else if (on?.kind === 'water') this.handlers.onWaterToggle(on.id)
      else {
        const r = rectBetween(drag.start, drag.end)
        const scene = this.state?.scene
        const lights = (scene?.lights ?? []).filter((l) => inRect(l, r) && !this.ghostLightIds.has(l.id)).map((l) => l.id)
        const points = wallPointsIn(scene?.walls ?? [], r)
        const objects = (scene?.objects ?? []).filter((o) => inRect(o, r)).map((o) => o.id)
        const characters = (scene?.characters ?? []).filter((t) => inRect(t, r)).map((t) => t.id)
        const bounds = scene && sceneBounds(scene)
        const water = bounds ? (scene.waterAreas ?? []).filter((w) => inRect(waterCentre(w, bounds), r)).map((w) => w.id) : []
        this.handlers.onBoxSelect(lights, points, objects, e.ctrlKey || e.metaKey, characters, water)
      }
      this.drag = null
      this.drawSelectionBox()
    } else if (clicked && drag?.mode === 'object' && drag.wasSelected && drag.group.length > 1) {
      // A click on one of a selection: just that one (a grouped one keeps its group, but Alt).
      if (!this.groupOf(drag.id, 'object') || e.altKey) this.handlers.onObjectSelect(drag.id)
    } else if (clicked && drag?.mode === 'light' && drag.wasSelected) {
      if (!this.groupOf(drag.id, 'light') || e.altKey) this.handlers.onLightSelect(drag.id)
    } else if (clicked && drag?.mode === 'character' && drag.wasSelected && drag.ids.length > 1) {
      // A click on one of several selected tokens: just that one (a grouped one keeps its group, but Alt).
      if (!this.groupOf(drag.id, 'character') || e.altKey) this.handlers.onCharacterSelect(drag.id)
    } else if (clicked && drag?.mode === 'wallPoint' && drag.wasSelected) {
      this.handlers.onWallPointSelect(drag.ref)
    } else if (clicked && drag && !onSomething && !e.ctrlKey && !e.metaKey) {
      this.handlers.onLightSelect(null) // clears the whole selection
    }
    // A mixed selection moves together: tokens slide in when the drag ends, objects and
    // lights moved with the drag (or, dragged by a token, by its move).
    if (drag?.mode === 'character') {
      this.clearGhosts()
      const leader = this.state?.scene.characters?.find((t) => t.id === drag.id)
      if (drag.to && leader && !clicked) {
        const dx = drag.to.x - leader.x
        const dy = drag.to.y - leader.y
        this.handlers.onCharactersMove(drag.ids, dx, dy)
        if (drag.wasSelected && (this.ui.selectedObjectIds.length || this.ui.selectedLightIds.length)) {
          this.handlers.onObjectsMove(this.ui.selectedObjectIds, dx, dy)
        }
      }
    } else if ((drag?.mode === 'object' || drag?.mode === 'light') && this.ui.selectedCharacterIds.length) {
      this.clearGhosts()
      const up = this.toScene(e)
      if (!clicked) this.handlers.onCharactersMove(this.ui.selectedCharacterIds, up.x - this.dragFrom.x, up.y - this.dragFrom.y)
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

/** The topmost character token at p. */
function characterAt(p: Point, scene: Scene): Target {
  const t = (scene.characters ?? []).findLast((t) => Math.hypot(p.x - t.x, p.y - t.y) <= tokenDiameter(t, scene) / 2)
  return t ? { kind: 'character', id: t.id } : null
}

function centroid(points: Point[]): Point {
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }
}
