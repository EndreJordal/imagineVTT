import { Application } from 'pixi.js'

/**
 * Owns a Pixi Application mounted into a DOM element. Init is async, so this handles
 * being destroyed before init finishes (e.g. React StrictMode double-mount).
 */
export abstract class PixiHost {
  protected app = new Application()
  protected ready = false
  private alive = true
  private init: Promise<boolean>

  constructor(host: HTMLElement, background: string) {
    this.init = this.app
      .init({
        resizeTo: host,
        background,
        antialias: true,
        resolution: window.devicePixelRatio,
        autoDensity: true,
      })
      .then(() => {
        if (!this.alive) {
          this.app.destroy(true, { children: true })
          return false
        }
        host.appendChild(this.app.canvas)
        this.ready = true
        this.setup()
        return true
      })
  }

  /** Called once the app is initialised and mounted. */
  protected abstract setup(): void

  destroy() {
    if (!this.alive) return
    this.alive = false
    void this.init.then((ok) => {
      if (ok) this.app.destroy(true, { children: true })
    })
  }
}
