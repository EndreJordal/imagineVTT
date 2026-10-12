import { Container, Mesh, MeshGeometry, RenderTexture, Shader, Texture, UniformGroup, type Renderer } from 'pixi.js'
import type { DoorEffect, DoorReveal } from '../shared/doors'

/**
 * A door opened on the table: what it hid comes into view with a little theatre. The view
 * from just before is kept, drawn over the new one, and lifted away from the door outwards
 * (wipe) or faded out, over what the party could see through it (beyond, the view
 * stays live). Sight, memory and hidden areas all change under it, so they stay in step.
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
uniform sampler2D uBefore;
uniform vec2 uDoor;        // the door, in screen uv
uniform float uAspect;     // screen width / height
uniform float uRadius;     // how far the reveal reaches, in screen heights
uniform float uProgress;   // 0..1
uniform float uMode;       // 1 fade, 2 wipe

void main() {
  vec2 d = (vUV - uDoor) * vec2(uAspect, 1.0);
  float dist = length(d) / uRadius;             // 0 at the door, 1 where the reveal ends
  float t = clamp(uProgress, 0.0, 1.0);
  float cover;                                  // 1: still the view from before
  if (uMode < 1.5) {
    cover = 1.0 - t * t * (3.0 - 2.0 * t);
  } else {
    float front = t * 1.2;
    cover = smoothstep(front - 0.12, front + 0.03, dist);
  }
  cover *= 1.0 - smoothstep(0.92, 1.0, dist);   // beyond the reveal, the live view
  finalColor = texture(uBefore, vUV) * cover;    // premultiplied
}
`

const MODES: Record<DoorEffect, number> = { none: 0, fade: 1, wipe: 2 }

export class DoorRevealLayer extends Container {
  private uniforms = new UniformGroup({
    uDoor: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
    uAspect: { value: 16 / 9, type: 'f32' },
    uRadius: { value: 1, type: 'f32' },
    uProgress: { value: 1, type: 'f32' },
    uMode: { value: 1, type: 'f32' },
  })
  private shader = Shader.from({
    gl: { vertex, fragment, name: 'imaginevtt-door-reveal' },
    resources: { revealUniforms: this.uniforms, uBefore: Texture.EMPTY.source },
  })
  private geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  private mesh = new Mesh({ geometry: this.geometry, shader: this.shader })
  private before: RenderTexture | null = null
  private size = { width: 1, height: 1 }
  private started = 0
  private duration = 0

  constructor() {
    super()
    this.addChild(this.mesh)
    this.mesh.visible = false
  }

  resize(width: number, height: number) {
    this.size = { width, height }
    this.uniforms.uniforms.uAspect = width / height
    this.uniforms.update()
  }

  /** Whether frames are needed: a reveal under way. */
  get animated() {
    return this.mesh.visible
  }

  /**
   * Keep the view as it is now (`scene` drawn as it stands, before the door opens), to reveal
   * the new one under it from `door` (screen px) out to `radius` (screen px).
   */
  start(renderer: Renderer, scene: Container, door: { x: number; y: number }, radius: number, reveal: DoorReveal) {
    const { width, height } = this.size
    if (!this.before || this.before.width !== width || this.before.height !== height) {
      this.release()
      this.before = RenderTexture.create({ width, height, resolution: renderer.resolution })
      this.shader.resources.uBefore = this.before.source
    }
    this.mesh.visible = false
    renderer.render({ container: scene, target: this.before, clear: true })
    // Drawn only over the reveal (a circle round the door), not the whole screen.
    const x0 = Math.max(0, door.x - radius)
    const y0 = Math.max(0, door.y - radius)
    const x1 = Math.min(width, door.x + radius)
    const y1 = Math.min(height, door.y + radius)
    this.mesh.position.set(x0, y0)
    this.mesh.scale.set(Math.max(1, x1 - x0), Math.max(1, y1 - y0))
    const [u0, v0, u1, v1] = [x0 / width, y0 / height, x1 / width, y1 / height]
    this.geometry.uvs = new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1])
    const u = this.uniforms.uniforms
    ;(u.uDoor as Float32Array).set([door.x / width, door.y / height])
    u.uRadius = Math.max(0.05, radius / height)
    u.uMode = MODES[reveal.effect]
    u.uProgress = 0
    this.uniforms.update()
    this.started = performance.now() / 1000
    this.duration = Math.max(0.05, reveal.duration)
    this.mesh.visible = true
  }

  /** Call every frame with the time in seconds. */
  animate(seconds: number) {
    if (!this.mesh.visible) return
    const t = (seconds - this.started) / this.duration
    if (t >= 1) {
      this.mesh.visible = false
      this.release() // screen-sized: not kept between doors
      return
    }
    this.uniforms.uniforms.uProgress = t
    this.uniforms.update()
  }

  private release() {
    if (!this.before) return
    this.shader.resources.uBefore = Texture.EMPTY.source // unbound before it's destroyed
    this.before.destroy(true)
    this.before = null
  }

  override destroy(options?: Parameters<Container['destroy']>[0]) {
    this.release()
    this.mesh.destroy()
    this.geometry.destroy()
    this.shader.destroy()
    super.destroy(options)
  }
}
