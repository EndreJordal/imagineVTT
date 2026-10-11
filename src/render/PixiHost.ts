import { Application } from 'pixi.js'

/** Most frames per second when something changes (dragging, panning). */
const MAX_FPS = 60
/** Frames per second for animation alone (light flicker); plenty for fire, and half the work. */
const ANIMATION_FPS = 30

/**
 * Owns a Pixi Application mounted into a DOM element. Init is async, so this handles
 * being destroyed before init finishes (e.g. React StrictMode double-mount).
 *
 * Frames are drawn on demand rather than on every display refresh: when something changed
 * (requestRender), capped at MAX_FPS, or while something animates (isAnimating), at
 * ANIMATION_FPS. A still scene costs nothing, which matters on laptops, high refresh rate
 * screens, and with two windows (GM and table) drawing at once.
 */
export abstract class PixiHost {
  protected app = new Application()
  protected ready = false
  private alive = true
  private init: Promise<boolean>
  private dirty = true
  private frame = 0
  private lastFrame = -Infinity

  constructor(host: HTMLElement, background: string) {
    this.init = this.app
      .init({
        resizeTo: host,
        background,
        antialias: true,
        resolution: window.devicePixelRatio,
        autoDensity: true,
        autoStart: false, // drawn by our own loop below
      })
      .then(() => {
        if (!this.alive) {
          this.app.destroy(true, { children: true })
          return false
        }
        host.appendChild(this.app.canvas)
        this.ready = true
        this.app.renderer.on('resize', () => this.requestRender())
        this.setup()
        this.frame = requestAnimationFrame(this.loop)
        return true
      })
  }

  /** Called once the app is initialised and mounted. */
  protected abstract setup(): void

  /** Something visible changed: draw a frame soon. */
  protected requestRender() {
    this.dirty = true
  }

  /** Whether frames are needed with nothing changed (animation). */
  protected isAnimating(): boolean {
    return false
  }

  /** Called before each frame is drawn (time in seconds), e.g. to advance animations. */
  protected beforeRender(seconds: number): void {
    void seconds
  }

  private loop = (now: number) => {
    this.frame = requestAnimationFrame(this.loop)
    const since = now - this.lastFrame
    // A couple of ms slack, so a 60Hz display isn't held to every other frame.
    const due = this.dirty
      ? since >= 1000 / MAX_FPS - 2
      : this.isAnimating() && since >= 1000 / ANIMATION_FPS - 2
    if (!due) return
    this.lastFrame = now
    this.dirty = false
    this.beforeRender(now / 1000)
    this.app.render()
  }

  destroy() {
    if (!this.alive) return
    this.alive = false
    cancelAnimationFrame(this.frame)
    void this.init.then((ok) => {
      if (ok) this.app.destroy(true, { children: true })
    })
  }
}
