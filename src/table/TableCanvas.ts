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

    const side = CALIBRATION_MM * display.pxPerMm
    const cx = screen.width / 2
    const cy = screen.height / 2
    const g = new Graphics()
      .rect(cx - side / 2, cy - side / 2, side, side)
      .moveTo(cx - side / 2, cy)
      .lineTo(cx + side / 2, cy)
      .moveTo(cx, cy - side / 2)
      .lineTo(cx, cy + side / 2)
      .stroke({ width: 2, color: 0xffcc00 })
    const label = new Text({
      text: `${CALIBRATION_MM} mm`,
      style: { fill: 0xffcc00, fontSize: 18, fontFamily: 'system-ui, sans-serif' },
    })
    label.anchor.set(0.5, 0)
    label.position.set(cx, cy + side / 2 + 8)
    this.calibration.addChild(g, label)
  }
}
