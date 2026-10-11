import { Container, ImageSource, Mesh, MeshGeometry, Shader, Texture, UniformGroup, type TextureSource } from 'pixi.js'
import { slideshowIds, type CurtainState, type CurtainTransition } from '../shared/curtain'

/**
 * The curtain on the table: a picture over the whole screen instead of the map, with
 * transitions between the map and pictures, and between pictures (slideshow). One quad
 * with a shader that mixes "from" and "to" by a transition mask; the map shows through
 * where neither is a picture.
 */

const vertex = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`

const fragment = /* glsl */ `#version 300 es
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec4 uFromRect;     // where the picture sits on screen (uv): x, y, width, height
uniform vec4 uToRect;
uniform float uFromOn;      // 0: the map (nothing drawn), 1: a picture
uniform float uToOn;
uniform float uProgress;    // 0..1 from "from" to "to"
uniform float uMode;        // 0 cut, 1 fade, 2 dissolve, 3 wipe, 4 iris
uniform float uAspect;      // screen width / height

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

/** A picture layer: black outside the picture (bars), nothing at all for the map. */
vec4 layer(sampler2D tex, vec4 rect, float on) {
  if (on < 0.5) return vec4(0.0);
  vec2 uv = (vUV - rect.xy) / rect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  vec4 c = texture(tex, uv);
  return vec4(c.rgb, 1.0); // premultiplied: transparent parts of a picture show as black
}

/** How far the transition has reached at this pixel: 0 shows "from", 1 shows "to". */
float reach(float t) {
  const float e = 0.08;            // soft edge
  float s = t * (1.0 + 2.0 * e) - e;
  if (uMode < 0.5) return step(0.5, t);
  if (uMode < 1.5) return t * t * (3.0 - 2.0 * t);
  if (uMode < 2.5) {
    float n = fbm(vUV * vec2(uAspect, 1.0) * 5.0);
    n = clamp((n - 0.2) / 0.6, 0.0, 1.0);
    return smoothstep(n - e, n + e, s);
  }
  if (uMode < 3.5) return smoothstep(vUV.x - e, vUV.x + e, s);
  vec2 d = (vUV - 0.5) * vec2(uAspect, 1.0);
  float r = length(d) / length(vec2(uAspect, 1.0) * 0.5);
  return smoothstep(r - e, r + e, s);
}

void main() {
  vec4 a = layer(uFrom, uFromRect, uFromOn);
  vec4 b = layer(uTo, uToRect, uToOn);
  finalColor = mix(a, b, reach(clamp(uProgress, 0.0, 1.0)));
}
`

/** Pictures bigger than this (px, longest side) are scaled down: 4K is plenty for a TV. */
const MAX_PX = 3840

async function fit(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const scale = MAX_PX / Math.max(bitmap.width, bitmap.height)
  if (scale >= 1) return bitmap
  const resizeWidth = Math.round(bitmap.width * scale)
  const resizeHeight = Math.round(bitmap.height * scale)
  const scaled = await createImageBitmap(bitmap, { resizeWidth, resizeHeight, resizeQuality: 'high' })
  bitmap.close()
  return scaled
}

const MODES: Record<CurtainTransition, number> = { cut: 0, fade: 1, dissolve: 2, wipe: 3, iris: 4 }

interface Picture {
  source: TextureSource
  bitmap: ImageBitmap
  width: number
  height: number
}

/** What's on show: a picture (by id), black (BLACK), or the map (null). */
type Shown = string | null

/** The curtain down without a picture to show (yet): black, never the map. */
const BLACK = ':black'

export class CurtainLayer extends Container {
  private uniforms = new UniformGroup({
    uFromRect: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
    uToRect: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
    uFromOn: { value: 0, type: 'f32' },
    uToOn: { value: 0, type: 'f32' },
    uProgress: { value: 1, type: 'f32' },
    uMode: { value: 1, type: 'f32' },
    uAspect: { value: 16 / 9, type: 'f32' },
  })
  private shader = Shader.from({
    gl: { vertex, fragment, name: 'imaginevtt-curtain' },
    resources: { curtainUniforms: this.uniforms, uFrom: Texture.EMPTY.source, uTo: Texture.EMPTY.source },
  })
  private geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  private mesh = new Mesh({ geometry: this.geometry, shader: this.shader })

  private state: CurtainState | null = null
  private images: Record<string, Blob> = {}
  private pictures = new Map<string, Picture>()
  private loading = new Map<string, Promise<Picture | null>>()
  private size = { width: 1, height: 1 }

  /** The transition under way (or finished): from what, to what, since when. */
  private from: Shown = null
  private to: Shown = null
  private started = 0
  private duration = 0
  /** Slideshow: which picture, and the timer for the next. */
  private slide = 0
  private slideTimer: number | undefined
  private now = 0
  /** Go to what's next without a transition: the table opened with the curtain down. */
  private instant = false
  onChange: () => void = () => {}

  constructor() {
    super()
    this.addChild(this.mesh)
    this.mesh.visible = false
  }

  /** The screen's size, in the layer's pixels. */
  resize(width: number, height: number) {
    this.size = { width, height }
    this.mesh.scale.set(width, height)
    this.uniforms.uniforms.uAspect = width / height
    this.layout()
  }

  set(state: CurtainState, images: Record<string, Blob>) {
    const first = !this.state
    this.state = state
    this.images = images
    for (const [id, p] of this.pictures) {
      if (!images[id]) {
        // Unbound first: Pixi warns about (and may draw) a destroyed texture still in use.
        if (this.shader.resources.uFrom === p.source) this.shader.resources.uFrom = Texture.EMPTY.source
        if (this.shader.resources.uTo === p.source) this.shader.resources.uTo = Texture.EMPTY.source
        p.source.destroy()
        p.bitmap.close()
        this.pictures.delete(id)
      }
    }
    const next = this.target()
    if (first && next !== null) {
      // Opened with the curtain down: straight to it, black until the picture is decoded.
      this.instant = true
      if (next !== BLACK && !this.pictures.has(next)) this.begin(BLACK)
    }
    this.go(next)
    this.scheduleSlide()
  }

  /** Whether frames are needed: a transition under way. */
  get animated() {
    return this.now - this.started < this.duration
  }

  /** The next slide, `interval` seconds from now (a timer: no frames drawn while waiting). */
  private scheduleSlide() {
    clearTimeout(this.slideTimer)
    this.slideTimer = undefined
    if (!this.slideshowRunning) return
    this.slideTimer = window.setTimeout(() => {
      this.slide++
      this.go(this.target())
      this.scheduleSlide()
    }, this.state!.slideshow.interval * 1000)
  }

  private get slideshowRunning() {
    return !!this.state?.down && !!this.state.slideshow.on && this.slideIds().length > 1
  }

  /** Call every frame with the time in seconds. */
  animate(seconds: number) {
    this.now = seconds
    const progress = this.duration > 0 ? (seconds - this.started) / this.duration : 1
    this.uniforms.uniforms.uProgress = Math.min(1, Math.max(0, progress))
    this.uniforms.update()
    // Nothing to draw once the map is back.
    this.mesh.visible = !(this.to === null && progress >= 1)
  }

  private slideIds() {
    return this.state ? slideshowIds(this.state, Object.keys(this.images).map((id) => ({ id }))) : []
  }

  /** What should be on show now. */
  private target(): Shown {
    const s = this.state
    if (!s?.down) return null
    const ids = this.slideIds()
    if (s.slideshow.on && ids.length >= 2) return ids[this.slide % ids.length]
    return s.imageId && this.images[s.imageId] ? s.imageId : BLACK
  }

  /** Start a transition to `next` (once its picture is decoded). */
  private go(next: Shown) {
    if (next === this.to) return
    if (next === null || next === BLACK || this.pictures.has(next)) {
      this.begin(next)
      return
    }
    void this.load(next).then((p) => {
      if (p && this.target() === next) this.begin(next)
    })
  }

  private begin(next: Shown) {
    const s = this.state!
    // Frames aren't drawn while nothing changes, so take the time now (the frame clock's).
    this.now = performance.now() / 1000
    // A transition interrupted midway continues from what's mostly on show.
    const progress = this.duration > 0 ? (this.now - this.started) / this.duration : 1
    this.from = progress >= 0.5 ? this.to : this.from
    this.to = next
    this.started = this.now
    this.duration = this.instant || s.transition === 'cut' ? 0 : s.duration
    if (next !== BLACK) this.instant = false
    const u = this.uniforms.uniforms
    u.uMode = MODES[s.transition]
    this.shader.resources.uFrom = this.picture(this.from)?.source ?? Texture.EMPTY.source
    this.shader.resources.uTo = this.picture(this.to)?.source ?? Texture.EMPTY.source
    // A layer "on" without a picture is black.
    u.uFromOn = this.from !== null ? 1 : 0
    u.uToOn = this.to !== null ? 1 : 0
    this.layout()
    this.mesh.visible = true
    this.onChange()
  }

  private picture(id: Shown) {
    return id ? this.pictures.get(id) : undefined
  }

  /** Where each picture sits on screen, for the fit setting. */
  private layout() {
    const u = this.uniforms.uniforms
    const place = (id: Shown, rect: Float32Array) => {
      const p = this.picture(id)
      if (!p) return rect.set([0, 0, 1, 1])
      const screen = this.size.width / this.size.height
      const image = p.width / p.height
      const cover = this.state?.fit !== 'contain'
      // Picture size relative to the screen: one side fits, the other overflows or falls short.
      const wide = image > screen
      const w = cover ? (wide ? image / screen : 1) : wide ? 1 : image / screen
      const h = cover ? (wide ? 1 : screen / image) : wide ? screen / image : 1
      rect.set([(1 - w) / 2, (1 - h) / 2, w, h])
    }
    place(this.from, u.uFromRect as Float32Array)
    place(this.to, u.uToRect as Float32Array)
    this.uniforms.update()
  }

  private load(id: string): Promise<Picture | null> {
    let p = this.loading.get(id)
    if (!p) {
      const blob = this.images[id]
      p = createImageBitmap(blob).then(fit).then(
        (bitmap) => {
          this.loading.delete(id)
          if (this.images[id] !== blob) {
            bitmap.close()
            return null
          }
          const picture = {
            bitmap,
            source: new ImageSource({ resource: bitmap, autoGenerateMipmaps: true }),
            width: bitmap.width,
            height: bitmap.height,
          }
          this.pictures.set(id, picture)
          return picture
        },
        () => {
          this.loading.delete(id)
          return null
        },
      )
      this.loading.set(id, p)
    }
    return p
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    clearTimeout(this.slideTimer)
    for (const p of this.pictures.values()) {
      p.source.destroy()
      p.bitmap.close()
    }
    this.pictures.clear()
    this.mesh.destroy()
    this.geometry.destroy()
    this.shader.destroy()
    super.destroy(options)
  }
}
