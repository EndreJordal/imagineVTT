import { Mesh, MeshGeometry, Shader, Texture, UniformGroup, type TextureSource } from 'pixi.js'

/**
 * The whole map in one GPU pass: map image, grid, night grading, light sources and fog of
 * war. Everything it reads covers the map's bounds (the light, sight and memory maps are
 * drawn over the same area), so one quad over the map samples them all at the same spot.
 *
 * Objects placed on the map (asset images) use the same shading, so they darken at night,
 * catch the light and hide in the fog exactly like the map under them.
 *
 * This replaces a stack of offscreen passes (night filter, light mask, memory filter and
 * mask, sight mask), which integrated GPUs struggled with, especially with two windows.
 */

// Pixi compiles a shader as GLSL ES 3.00 (WebGL2) only when it says so; fwidth needs it.
const vertex = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
out vec2 vScene;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vScene = aPosition;
}
`

/** Uniforms and the shading shared by the map and objects: night, lights, fog. */
const shading = /* glsl */ `
uniform sampler2D uLightMask;
uniform sampler2D uGlow;
uniform sampler2D uVision;
uniform sampler2D uMemory;
uniform sampler2D uHidden;     // hidden areas, soft-edged (red), over the map's bounds

uniform vec4 uBounds;          // scene x, y, width, height of the map
uniform float uHasMap;
uniform float uMapTurns;       // quarter turns clockwise the map image is shown at
uniform vec3 uBackground;      // shown where there is no map image
uniform vec4 uGrid;            // size, offset x, offset y, visible
uniform vec4 uGridColor;       // rgb, opacity
uniform float uSaturation;     // night: colour kept (1 = day)
uniform float uBrightness;     // night: light kept (1 = day)
uniform float uLightsOn;
uniform vec2 uLightUv;         // map uv -> light map uv (light maps are rounded up in size)
uniform float uFogMode;        // 0 off, 1 players, 2 GM
uniform vec2 uVisionUv;        // map uv -> sight map uv
uniform float uMemoryBrightness;
uniform float uGmShade;
uniform float uHiddenMode;     // hidden areas: 0 none, 1 players (black), 2 GM (shaded)

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

/** A day-lit colour as seen at map uv: under night, light sources and fog of war. */
vec3 shade(vec3 day, vec2 uv) {
  // Night: desaturate towards luminance, then dim.
  vec3 night = mix(vec3(dot(day, LUMA)), day, uSaturation) * uBrightness;
  vec3 color = night;

  // Light sources reveal the day-lit colour, and add their own.
  if (uLightsOn > 0.5) {
    vec2 luv = uv * uLightUv;
    color = mix(night, day, clamp(texture(uLightMask, luv).r, 0.0, 1.0)) + texture(uGlow, luv).rgb;
  }

  if (uFogMode > 1.5) {
    // GM: everything, with unexplored parts shaded.
    color *= 1.0 - uGmShade * (1.0 - texture(uMemory, uv).r);
  } else if (uFogMode > 0.5) {
    // Players: what's in sight now; elsewhere a greyscale memory of explored parts, or black.
    float seen = clamp(texture(uVision, uv * uVisionUv).r, 0.0, 1.0);
    vec3 memory = vec3(dot(day, LUMA)) * uMemoryBrightness * texture(uMemory, uv).r;
    color = mix(memory, color, seen);
  }

  // Hidden areas: black for the players whatever they see; shaded and tinted for the GM.
  if (uHiddenMode > 0.5) {
    float hidden = texture(uHidden, uv).r;
    color = uHiddenMode > 1.5 ? mix(color, color * 0.3 + vec3(0.06, 0.02, 0.1), hidden) : color * (1.0 - hidden);
  }
  return color;
}
`

const mapFragment = /* glsl */ `#version 300 es
in vec2 vUV;
in vec2 vScene;
out vec4 finalColor;

uniform sampler2D uMap;
${shading}

/** Where in the image a point of the (turned) map is. */
vec2 imageUv(vec2 uv) {
  if (uMapTurns < 0.5) return uv;
  if (uMapTurns < 1.5) return vec2(uv.y, 1.0 - uv.x);
  if (uMapTurns < 2.5) return 1.0 - uv;
  return vec2(1.0 - uv.y, uv.x);
}

void main() {
  vec2 scene = uBounds.xy + vUV * uBounds.zw;
  vec3 day = uHasMap > 0.5 ? texture(uMap, imageUv(vUV)).rgb : uBackground;

  // Grid lines, about one screen pixel wide at any zoom.
  if (uGrid.w > 0.5) {
    vec2 cell = (scene - uGrid.yz) / uGrid.x;
    vec2 dist = abs(fract(cell + 0.5) - 0.5) * uGrid.x;   // scene units to the nearest line
    vec2 pixel = fwidth(scene);                            // scene units per screen pixel
    vec2 on = 1.0 - smoothstep(pixel * 0.5, pixel, dist);
    day = mix(day, uGridColor.rgb, max(on.x, on.y) * uGridColor.a);
  }

  finalColor = vec4(shade(day, vUV), 1.0);
}
`

// Objects: their own image (premultiplied alpha) at their place, shaded like the map there.
const objectFragment = /* glsl */ `#version 300 es
in vec2 vUV;
in vec2 vScene;
out vec4 finalColor;

uniform sampler2D uObject;
uniform vec4 uFrame;           // the frame's rect in the image: x, y, width, height (uv)
${shading}

void main() {
  vec4 tex = texture(uObject, uFrame.xy + vUV * uFrame.zw);
  if (tex.a < 0.004) discard;
  vec3 day = tex.rgb / tex.a;
  vec2 uv = clamp((vScene - uBounds.xy) / uBounds.zw, 0.0, 1.0);
  finalColor = vec4(shade(day, uv) * tex.a, tex.a);
}
`

export interface MapUniforms {
  uBounds: Float32Array
  uHasMap: number
  uMapTurns: number
  uBackground: Float32Array
  uGrid: Float32Array
  uGridColor: Float32Array
  uSaturation: number
  uBrightness: number
  uLightsOn: number
  uLightUv: Float32Array
  uFogMode: number
  uVisionUv: Float32Array
  uMemoryBrightness: number
  uGmShade: number
  uHiddenMode: number
}

/** The light, sight and memory maps the shading reads (shared by the map and objects). */
export type SharedTextureSlot = 'uLightMask' | 'uGlow' | 'uVision' | 'uMemory' | 'uHidden'
export type MapTextureSlot = 'uMap' | SharedTextureSlot
export const SHARED_SLOTS: SharedTextureSlot[] = ['uLightMask', 'uGlow', 'uVision', 'uMemory', 'uHidden']

/** A unit quad (0..1) carrying the map shader; position and scale it to the map's bounds. */
export function createMapMesh() {
  const group = new UniformGroup({
    uBounds: { value: new Float32Array(4), type: 'vec4<f32>' },
    uHasMap: { value: 0, type: 'f32' },
    uMapTurns: { value: 0, type: 'f32' },
    uBackground: { value: new Float32Array([0x2a / 255, 0x2a / 255, 0x30 / 255]), type: 'vec3<f32>' },
    uGrid: { value: new Float32Array(4), type: 'vec4<f32>' },
    uGridColor: { value: new Float32Array(4), type: 'vec4<f32>' },
    uSaturation: { value: 1, type: 'f32' },
    uBrightness: { value: 1, type: 'f32' },
    uLightsOn: { value: 0, type: 'f32' },
    uLightUv: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uFogMode: { value: 0, type: 'f32' },
    uVisionUv: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
    uMemoryBrightness: { value: 0.4, type: 'f32' },
    uGmShade: { value: 0.55, type: 'f32' },
    uHiddenMode: { value: 0, type: 'f32' },
  })
  const empty = Texture.EMPTY.source
  const shader = Shader.from({
    // highp: scene coordinates run to thousands, and the grid maths needs sub-pixel precision.
    gl: { vertex, fragment: mapFragment, name: 'imaginevtt-map', preferredFragmentPrecision: 'highp' },
    resources: {
      mapUniforms: group,
      uMap: empty,
      uLightMask: empty,
      uGlow: empty,
      uVision: empty,
      uMemory: empty,
      uHidden: empty,
    },
  })
  const geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  const mesh = new Mesh({ geometry, shader })

  return {
    mesh,
    /** The uniform group, for objects to share (see createObjectMesh). */
    group,
    uniforms: group.uniforms as unknown as MapUniforms,
    /** Call after changing uniform values. */
    uniformsChanged: () => group.update(),
    setTexture(slot: MapTextureSlot, source: TextureSource | null) {
      shader.resources[slot] = source ?? empty
    },
  }
}

/**
 * A quad for one object, with its corners in scene coordinates (so rotation is in the
 * geometry) and the map's shading uniforms shared, so the scene's night, lights and fog
 * apply to it as they do to the map.
 */
export function createObjectMesh(mapGroup: UniformGroup) {
  const frame = new UniformGroup({ uFrame: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' } })
  const empty = Texture.EMPTY.source
  const shader = Shader.from({
    gl: { vertex, fragment: objectFragment, name: 'imaginevtt-object', preferredFragmentPrecision: 'highp' },
    resources: {
      mapUniforms: mapGroup,
      objectUniforms: frame,
      uObject: empty,
      uLightMask: empty,
      uGlow: empty,
      uVision: empty,
      uMemory: empty,
      uHidden: empty,
    },
  })
  const geometry = new MeshGeometry({
    positions: new Float32Array(8),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  })
  const mesh = new Mesh({ geometry, shader })
  return {
    mesh,
    /** Corners: top-left, top-right, bottom-right, bottom-left, in scene coordinates. */
    setCorners(corners: { x: number; y: number }[]) {
      geometry.positions = new Float32Array(corners.flatMap((p) => [p.x, p.y]))
    },
    /** The part of the image to show (uv rect), for animation frames. */
    setFrame(x: number, y: number, w: number, h: number) {
      const f = frame.uniforms.uFrame as Float32Array
      if (f[0] === x && f[1] === y && f[2] === w && f[3] === h) return false
      f.set([x, y, w, h])
      frame.update()
      return true
    },
    setTexture(slot: 'uObject' | SharedTextureSlot, source: TextureSource | null) {
      shader.resources[slot] = source ?? empty
    },
    destroy() {
      mesh.destroy()
      geometry.destroy()
      shader.destroy()
    },
  }
}
