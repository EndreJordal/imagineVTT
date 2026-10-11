import { Mesh, MeshGeometry, Shader, Texture, UniformGroup, type TextureSource } from 'pixi.js'

/**
 * The whole map in one GPU pass: map image, grid, night grading, light sources and fog of
 * war. Everything it reads covers the map's bounds (the light, sight and memory maps are
 * drawn over the same area), so one quad over the map samples them all at the same spot.
 *
 * This replaces a stack of offscreen passes (night filter, light mask, memory filter and
 * mask, sight mask), which integrated GPUs struggled with, especially with two windows.
 */

// Pixi compiles a shader as GLSL ES 3.00 (WebGL2) only when it says so; fwidth needs it.
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

uniform sampler2D uMap;
uniform sampler2D uLightMask;
uniform sampler2D uGlow;
uniform sampler2D uVision;
uniform sampler2D uMemory;

uniform vec4 uBounds;          // scene x, y, width, height of the map
uniform float uHasMap;
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

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec2 scene = uBounds.xy + vUV * uBounds.zw;
  vec3 day = uHasMap > 0.5 ? texture(uMap, vUV).rgb : uBackground;

  // Grid lines, about one screen pixel wide at any zoom.
  if (uGrid.w > 0.5) {
    vec2 cell = (scene - uGrid.yz) / uGrid.x;
    vec2 dist = abs(fract(cell + 0.5) - 0.5) * uGrid.x;   // scene units to the nearest line
    vec2 pixel = fwidth(scene);                            // scene units per screen pixel
    vec2 on = 1.0 - smoothstep(pixel * 0.5, pixel, dist);
    day = mix(day, uGridColor.rgb, max(on.x, on.y) * uGridColor.a);
  }

  // Night: desaturate towards luminance, then dim.
  vec3 night = mix(vec3(dot(day, LUMA)), day, uSaturation) * uBrightness;
  vec3 color = night;

  // Light sources reveal the day-lit map, and add their colour.
  if (uLightsOn > 0.5) {
    vec2 luv = vUV * uLightUv;
    color = mix(night, day, clamp(texture(uLightMask, luv).r, 0.0, 1.0)) + texture(uGlow, luv).rgb;
  }

  if (uFogMode > 1.5) {
    // GM: everything, with unexplored parts shaded.
    color *= 1.0 - uGmShade * (1.0 - texture(uMemory, vUV).r);
  } else if (uFogMode > 0.5) {
    // Players: what's in sight now; elsewhere a greyscale memory of explored parts, or black.
    float seen = clamp(texture(uVision, vUV * uVisionUv).r, 0.0, 1.0);
    vec3 memory = vec3(dot(day, LUMA)) * uMemoryBrightness * texture(uMemory, vUV).r;
    color = mix(memory, color, seen);
  }

  finalColor = vec4(color, 1.0);
}
`

export interface MapUniforms {
  uBounds: Float32Array
  uHasMap: number
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
}

export type MapTextureSlot = 'uMap' | 'uLightMask' | 'uGlow' | 'uVision' | 'uMemory'

/** A unit quad (0..1) carrying the map shader; position and scale it to the map's bounds. */
export function createMapMesh() {
  const uniforms = new UniformGroup({
    uBounds: { value: new Float32Array(4), type: 'vec4<f32>' },
    uHasMap: { value: 0, type: 'f32' },
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
  })
  const empty = Texture.EMPTY.source
  const shader = Shader.from({
    // highp: scene coordinates run to thousands, and the grid maths needs sub-pixel precision.
    gl: { vertex, fragment, name: 'imaginevtt-map', preferredFragmentPrecision: 'highp' },
    resources: {
      mapUniforms: uniforms,
      uMap: empty,
      uLightMask: empty,
      uGlow: empty,
      uVision: empty,
      uMemory: empty,
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
    uniforms: uniforms.uniforms as unknown as MapUniforms,
    /** Call after changing uniform values. */
    uniformsChanged: () => uniforms.update(),
    setTexture(slot: MapTextureSlot, source: TextureSource | null) {
      shader.resources[slot] = source ?? empty
    },
  }
}
