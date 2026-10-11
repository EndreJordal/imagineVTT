import { Container, Graphics, Text } from 'pixi.js'
import { PixiHost } from '../render/PixiHost'
import { SceneLayer } from '../render/SceneLayer'
import { CALIBRATION_MM, tableTransform } from '../shared/geometry'
import type { FogMemory } from '../shared/fog'
import type { TableState } from '../shared/types'

/** Display-only renderer for the table TV. Fixed physical scale, no input. */
export class TableCanvas extends PixiHost {
  private sceneLayer = new SceneLayer()
  private calibration = new Container()
  private state: TableState | null = null
  private image: Blob | null = null
  private fogMemory: FogMemory | null = null

  constructor(host: HTMLElement) {
    super(host, '#000000')
  }

  protected setup() {
    this.app.stage.addChild(this.sceneLayer, this.calibration)
    this.app.renderer.on('resize', () => this.render())
    this.app.ticker.add(() => this.sceneLayer.animate(this.app.renderer, performance.now() / 1000))
    void this.sceneLayer.setMapImage(this.image)
    this.sceneLayer.setFogMemory(this.fogMemory)
    this.render()
  }

  setState(state: TableState) {
    this.state = state
    this.render()
  }

  setFogMemory(memory: FogMemory | null) {
    this.fogMemory = memory
    if (this.ready) this.sceneLayer.setFogMemory(memory)
  }

  setMapImage(image: Blob | null) {
    this.image = image
    if (this.ready) void this.sceneLayer.setMapImage(image)
  }

  private render() {
    if (!this.ready || !this.state) return
    const { scene, display, calibrating } = this.state
    const screen = this.app.screen

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
