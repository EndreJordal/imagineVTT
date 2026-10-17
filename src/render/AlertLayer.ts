import { Container, Graphics } from 'pixi.js'
import type { Point } from '../shared/types'

/** How long an alert shows, in seconds: the ring closing in, then pulses on the spot. */
const DURATION = 2.2
const CLOSE_IN = 0.45
const FADE = 0.35
/** Sizes in squares: where the ring starts, and the spot it closes in on. */
const START_SQUARES = 6
const SPOT_SQUARES = 0.55

const COLOR = 0xff5a36
const CORE = 0xffffff

interface Alert {
  at: Point
  g: Graphics
  start: number | null
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

/**
 * The GM's alerts: a ring that starts large and closes in on a spot, then keeps pulsing there
 * for a couple of seconds. Drawn over everything, so it shows on any map, lit or not.
 */
export class AlertLayer extends Container {
  private alerts: Alert[] = []
  private grid = 100

  get animated() {
    return this.alerts.length > 0
  }

  /** Squares are this many scene units (alerts are sized in squares). */
  setGrid(size: number) {
    this.grid = size
  }

  add(at: Point) {
    const g = new Graphics()
    this.addChild(g)
    this.alerts.push({ at, g, start: null })
  }

  animate(seconds: number) {
    for (const a of [...this.alerts]) {
      a.start ??= seconds
      const t = seconds - a.start
      if (t >= DURATION) {
        a.g.destroy()
        this.alerts.splice(this.alerts.indexOf(a), 1)
        continue
      }
      this.draw(a, t)
    }
  }

  private draw(a: Alert, t: number) {
    const sq = this.grid
    const spot = SPOT_SQUARES * sq
    const { x, y } = a.at
    const fade = t > DURATION - FADE ? (DURATION - t) / FADE : 1
    const g = a.g.clear()
    g.alpha = fade
    const ring = (r: number, width: number, alpha: number) =>
      g
        .circle(x, y, r)
        .stroke({ width: width + sq * 0.08, color: 0x000000, alpha: alpha * 0.6 })
        .circle(x, y, r)
        .stroke({ width, color: COLOR, alpha })

    if (t < CLOSE_IN) {
      // Closing in: a thick ring sweeping down from far out onto the spot.
      const k = easeOut(t / CLOSE_IN)
      const r = START_SQUARES * sq + (spot - START_SQUARES * sq) * k
      ring(r, sq * (0.35 - 0.2 * k), 0.4 + 0.6 * k)
      return
    }
    // On the spot: a pulsing dot in a ring, and ripples going out from it.
    const p = t - CLOSE_IN
    const beat = 0.5 + 0.5 * Math.sin(p * Math.PI * 4)
    for (let i = 0; i < 3; i++) {
      const k = ((p / 0.6 + i / 3) % 1 + 1) % 1
      ring(spot + k * sq * 1.6, sq * 0.1 * (1 - k), (1 - k) * 0.9)
    }
    ring(spot * (1 + 0.15 * beat), sq * 0.16, 1)
    g.circle(x, y, spot * (0.35 + 0.1 * beat)).fill({ color: CORE, alpha: 0.95 })
  }
}
