import { Container, Graphics, Text } from 'pixi.js'
import { CurtainLayer } from '../render/CurtainLayer'
import { HandoutLayer } from '../render/HandoutLayer'
import { InitiativeLayer } from '../render/InitiativeLayer'
import type { OrderStrip } from '../shared/combat'
import { DoorRevealLayer } from '../render/DoorRevealLayer'
import { PixiHost } from '../render/PixiHost'
import { SceneLayer } from '../render/SceneLayer'
import type { CurtainState } from '../shared/curtain'
import { doorMiddle, doorReveal, openedDoors } from '../shared/doors'
import { CALIBRATION_MM, tableTransform } from '../shared/geometry'
import type { FogMemory } from '../shared/fog'
import { activeAreas } from '../shared/hidden'
import type { AssetImages } from '../shared/mapObjects'
import { reuse } from '../shared/reuse'
import type { TableState } from '../shared/types'

/** Display-only renderer for the table TV. Fixed physical scale, no input. */
export class TableCanvas extends PixiHost {
  private sceneLayer = new SceneLayer()
  private calibration = new Container()
  private curtain = new CurtainLayer()
  private handout = new HandoutLayer()
  /** The order of initiative of the linked fight, along the edge (under the curtain). */
  private initiative = new InitiativeLayer()
  private order: OrderStrip | null = null
  private handoutShown: Parameters<HandoutLayer['set']>[0] = null
  /** Whether the table has drawn yet (a picture showing as it opens appears at once). */
  private drawn = false
  /** A door opening: what it hid comes into view with its effect. */
  private doorReveal = new DoorRevealLayer()
  private curtainState: CurtainState | null = null
  private curtainImages: Record<string, Blob> = {}
  private state: TableState | null = null
  private image: Blob | null = null
  private fogMemory: FogMemory | null = null

  constructor(host: HTMLElement) {
    super(host, '#000000')
  }

  protected setup() {
    this.app.stage.addChild(this.sceneLayer, this.doorReveal, this.initiative, this.curtain, this.handout, this.calibration)
    this.initiative.onChange = () => this.requestRender()
    this.initiative.setStrip(this.order)
    this.handout.onChange = () => this.requestRender()
    this.handout.set(this.handoutShown, true)
    this.drawn = true
    this.sceneLayer.onChange = () => this.requestRender()
    this.curtain.onChange = () => this.requestRender()
    this.updateCurtain()
    this.app.renderer.on('resize', () => this.render())
    void this.sceneLayer.setMapImage(this.image).then(() => this.requestRender())
    this.sceneLayer.setFogMemory(this.fogMemory)
    this.render()
  }

  setState(state: TableState) {
    // Each message is a fresh copy: keep what didn't change as it was, so the layers' caches
    // (lights, sight, hidden areas) hold, and a message that changes nothing draws nothing.
    const next = reuse(this.state, state)
    if (next === this.state) return
    this.revealOpenedDoor(next)
    this.state = next
    this.render()
  }

  /**
   * A door opened where something is obscured: keep the view from before it did, to reveal
   * the new one with the door's effect, from the door out as far as the party's sight reaches.
   */
  private revealOpenedDoor(next: TableState) {
    const scene = next.scene
    if (!this.ready || !this.state || this.state.scene.walls === scene.walls) return
    if (scene.fog.mode === 'off' && !activeAreas(scene).length) return
    const door = openedDoors(this.state.scene.walls, scene.walls).find((w) => doorReveal(scene, w).effect !== 'none')
    if (!door) return
    const middle = doorMiddle(door.points)
    let reach = 0
    for (const l of scene.lights) {
      if (l.vision) reach = Math.max(reach, Math.hypot(l.x - middle.x, l.y - middle.y) + l.visionRange * scene.grid.size)
    }
    if (!reach) return
    const at = this.sceneLayer.toGlobal(middle)
    const scale = this.sceneLayer.worldTransform.a ** 2 + this.sceneLayer.worldTransform.b ** 2
    this.doorReveal.start(this.app.renderer, this.app.stage, at, reach * Math.sqrt(scale), doorReveal(scene, door))
    this.requestRender()
  }

  setFogMemory(memory: FogMemory | null) {
    this.fogMemory = memory
    if (this.ready) this.sceneLayer.setFogMemory(memory)
    this.requestRender()
  }

  /** Images of the assets objects show. */
  /** The players' order of initiative (null: none), and a glow on whoever is acting. */
  setOrder(strip: OrderStrip | null) {
    this.order = strip
    this.sceneLayer.characters.setActive(strip?.entries.find((e) => e.active)?.id ?? null)
    if (this.ready) this.initiative.setStrip(strip)
    this.requestRender()
  }

  setObjectImages(images: AssetImages) {
    this.initiative.setImages(images)
    this.sceneLayer.setObjectImages(images)
    this.requestRender()
  }

  /** The curtain: a picture over the map (only on the table). */
  setCurtain(state: CurtainState) {
    this.curtainState = state
    this.updateCurtain()
  }

  /** A picture shown to the players over everything (null: none). */
  setHandout(handout: Parameters<HandoutLayer['set']>[0]) {
    this.handoutShown = handout
    if (this.ready) this.handout.set(handout, !this.drawn)
  }

  setCurtainImages(images: Record<string, Blob>) {
    this.curtainImages = images
    this.updateCurtain()
  }

  private updateCurtain() {
    if (this.ready && this.curtainState) this.curtain.set(this.curtainState, this.curtainImages)
    this.requestRender()
  }

  setMapImage(image: Blob | null) {
    this.image = image
    if (this.ready) void this.sceneLayer.setMapImage(image).then(() => this.requestRender())
  }

  protected override isAnimating() {
    return (
      this.sceneLayer.isAnimating() ||
      this.curtain.animated ||
      this.doorReveal.animated ||
      this.handout.animated ||
      this.initiative.animated
    )
  }

  protected override beforeRender(seconds: number) {
    this.sceneLayer.animate(this.app.renderer, seconds)
    this.curtain.animate(seconds)
    this.handout.animate(seconds)
    this.doorReveal.animate(seconds)
    this.initiative.animate(seconds)
  }

  private render() {
    this.requestRender()
    if (!this.ready || !this.state) return
    const { scene, display, calibrating } = this.state
    const screen = this.app.screen
    this.curtain.resize(screen.width, screen.height)
    this.handout.resize(screen.width, screen.height)
    this.initiative.resize(screen.width, screen.height, display.pxPerMm)
    this.doorReveal.resize(screen.width, screen.height)

    this.sceneLayer.visible = !calibrating
    this.sceneLayer.update(scene, 'players')
    const t = tableTransform(scene, display, screen)
    this.sceneLayer.scale.set(t.scale)
    this.sceneLayer.rotation = t.rotation
    this.sceneLayer.pivot.set(t.pivot.x, t.pivot.y)
    this.sceneLayer.position.set(t.position.x, t.position.y)

    this.calibration.removeChildren().forEach((c) => c.destroy())
    this.calibration.visible = calibrating
    if (!calibrating) return

    // One square, CALIBRATION_MM a side. The top edge is marked like a ruler (a tick every
    // 10 mm, longer at the middle) with a dimension arrow above it: that's the edge to measure.
    const mm = display.pxPerMm
    const side = CALIBRATION_MM * mm
    const left = screen.width / 2 - side / 2
    const top = screen.height / 2 - side / 2
    const color = 0xffcc00
    const g = new Graphics().rect(left, top, side, side).stroke({ width: 2, color })
    for (let at = 10; at < CALIBRATION_MM; at += 10) {
      const length = at === CALIBRATION_MM / 2 ? 18 : 9
      g.moveTo(left + at * mm, top).lineTo(left + at * mm, top + length)
    }
    g.stroke({ width: 2, color })

    // Dimension line with arrowheads, above the top edge.
    const y = top - 22
    const head = 8
    g.moveTo(left, y).lineTo(left + side, y)
    g.moveTo(left, y - 10).lineTo(left, top - 4) // end marks, down towards the corners
    g.moveTo(left + side, y - 10).lineTo(left + side, top - 4)
    g.stroke({ width: 2, color })
    g.poly([left, y, left + head, y - head / 2, left + head, y + head / 2]).fill(color)
    g.poly([left + side, y, left + side - head, y - head / 2, left + side - head, y + head / 2]).fill(color)

    const label = new Text({
      text: `Measure this edge: it should be ${CALIBRATION_MM} mm`,
      style: { fill: color, fontSize: 18, fontFamily: 'system-ui, sans-serif' },
    })
    label.anchor.set(0.5, 1)
    label.position.set(left + side / 2, y - 8)
    this.calibration.addChild(g, label)
  }
}
