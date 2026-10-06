// Owns the WebGL2 context. Each frame: scene → bloom (¼ size) → post → screen.
import { BAKE_SCALE, DISTANCE_LEVELS, REGION_ROWS, SILHOUETTE_LEVELS, type Baked } from '../bake/bake.ts';
import { createProgram, createTarget, createTexture, deleteTarget, uniforms, type Target } from './webgl.ts';
import type { FrameState } from '../director/director.ts';
import { VIEWS, type Params } from '../params.ts';
import vertexSrc from '../shaders/fullscreen.vert?raw';
import commonSrc from '../shaders/common.glsl?raw';
import sceneSrc from '../shaders/scene.frag?raw';
import bloomSrc from '../shaders/bloom.frag?raw';
import postSrc from '../shaders/post.frag?raw';

const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
/** Upper limit on rendered pixels (before the quality slider); keeps big screens smooth. */
const MAX_PIXELS = 2_600_000;
/** Centre of the spotlight on the backdrop, in art units: behind the head, a little to the right. */
const SPOT_ART: [number, number] = [820, 420];

export type Renderer = {
  draw(frame: FrameState, params: Params): void;
};

export function createRenderer(canvas: HTMLCanvasElement, baked: Baked, artWidth: number, artHeight: number): Renderer {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const hdr = !!gl.getExtension('EXT_color_buffer_float');

  const scene = createProgram(gl, vertexSrc, HEADER + commonSrc + sceneSrc);
  const bloom = createProgram(gl, vertexSrc, HEADER + bloomSrc);
  const post = createProgram(gl, vertexSrc, HEADER + commonSrc + postSrc);
  const su = uniforms(gl, scene);
  const bu = uniforms(gl, bloom);
  const pu = uniforms(gl, post);
  gl.bindVertexArray(gl.createVertexArray());

  // Baked textures live on units 0–4 for the whole session.
  const { width, height } = baked;
  const baked2d = [
    ['uIds', createTexture(gl, { width, height, internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: baked.ids })],
    ['uInk', createTexture(gl, { width, height, internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, data: baked.ink, smooth: true })],
    ['uDistance', createTexture(gl, { width, height, internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, data: baked.distance, smooth: true })],
    ['uSilhouette', createTexture(gl, { width, height, internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, data: baked.silhouette, smooth: true })],
    [
      'uRegions',
      createTexture(gl, { width: baked.regionCount + 1, height: REGION_ROWS, internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, data: baked.regionData }),
    ],
  ] as const;
  gl.useProgram(scene);
  baked2d.forEach(([name, texture], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    su.i(name, unit);
  });
  su.f('uArtSize', artWidth, artHeight);
  su.f('uBakeScale', BAKE_SCALE);
  su.f('uDistanceLevels', DISTANCE_LEVELS);
  su.f('uSilhouetteLevels', SILHOUETTE_LEVELS);
  const SAMPLER_A = 5; // units for sampling render targets
  const SAMPLER_B = 6;
  const SCRATCH_UNIT = 7; // where new textures get created

  let sceneTarget: Target | null = null;
  let bloomA: Target | null = null;
  let bloomB: Target | null = null;

  function resize(quality: number) {
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(dpr, Math.sqrt(MAX_PIXELS / Math.max(cssW * cssH, 1))) * quality;
    const w = Math.max(1, Math.round(cssW * scale));
    const h = Math.max(1, Math.round(cssH * scale));
    if (sceneTarget && canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    for (const t of [sceneTarget, bloomA, bloomB]) if (t) deleteTarget(gl!, t);
    gl!.activeTexture(gl!.TEXTURE0 + SCRATCH_UNIT); // keep the baked textures bound on units 0–4
    sceneTarget = createTarget(gl!, w, h, hdr);
    const bw = Math.max(1, Math.round(w / 4));
    const bh = Math.max(1, Math.round(h / 4));
    bloomA = createTarget(gl!, bw, bh, hdr);
    bloomB = createTarget(gl!, bw, bh, hdr);
  }

  function bind(target: Target | null, w: number, h: number) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, target ? target.framebuffer : null);
    gl!.viewport(0, 0, w, h);
  }

  function sample(unit: number, target: Target) {
    gl!.activeTexture(gl!.TEXTURE0 + unit);
    gl!.bindTexture(gl!.TEXTURE_2D, target.texture);
  }

  return {
    draw(frame, params) {
      resize(params.quality);
      const w = canvas.width;
      const h = canvas.height;
      const viewIndex = Object.keys(VIEWS).indexOf(params.view);
      const m = frame.mood;

      // Layout: the snake stands on the bottom edge, a little left of centre.
      const artScale = Math.min(h / artHeight, w / artWidth);
      const originX = (w - artWidth * artScale) * 0.42;
      const originY = h - artHeight * artScale;

      // ----- Scene -----
      bind(sceneTarget, w, h);
      gl.useProgram(scene);
      su.f('uResolution', w, h);
      su.f('uArtOrigin', originX, originY);
      su.f('uArtScale', artScale);
      su.f('uTime', frame.time % 43200);
      su.i('uView', viewIndex);
      su.f('uBackDark', ...m.backDark);
      su.f('uBackLight', ...m.backLight);
      su.f('uKey', ...m.key);
      su.f('uRim', ...m.rim);
      su.f('uAmbient', ...m.ambient);
      su.f('uScale', ...m.scale);
      su.f('uBand', ...m.band);
      su.f('uBandAmount', m.bandAmount);
      su.f('uBelly', ...m.belly);
      su.f('uCavity', ...m.cavity);
      su.f('uIris', ...m.iris);
      su.f('uMetal', m.metal);
      su.f('uRoughness', m.roughness);
      su.f('uWrap', m.wrap);
      su.f('uKeyDir', ...frame.keyDir);
      su.f('uRimDir', ...frame.rimDir);
      su.f('uRipple', ...frame.ripple);
      su.f('uRippleStrength', frame.rippleStrength);
      su.f('uSweep', ...frame.sweep);
      su.f('uShade', ...frame.shade);
      su.f('uEyeGlint', frame.eyeGlint);
      su.f('uDust', frame.dust);
      su.f('uSpot', originX + SPOT_ART[0] * artScale, originY + SPOT_ART[1] * artScale);
      su.f('uSpotRadius', h * 0.5);
      su.f('uBevel', params.bevel);
      su.f('uRelief', params.relief);
      su.f('uSpecular', params.specular);
      su.f('uMetalBias', params.metalBias);
      su.f('uShadows', params.shadows);
      su.f('uSpotAmount', params.spot);
      su.f('uDustAmount', params.dust);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ----- Bloom: bright parts at ¼ size, blurred twice -----
      gl.useProgram(bloom);
      bu.i('uSource', SAMPLER_A);
      bu.f('uThreshold', hdr ? 1.0 : 0.75);
      const pass = (src: Target, dst: Target, mode: number, dx: number, dy: number) => {
        bind(dst, dst.width, dst.height);
        sample(SAMPLER_A, src);
        bu.f('uSourceTexel', 1 / src.width, 1 / src.height);
        bu.f('uTargetSize', dst.width, dst.height);
        bu.i('uMode', mode);
        bu.f('uDirection', dx, dy);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      pass(sceneTarget!, bloomA!, 0, 0, 0);
      for (const spread of [1, 2.5]) {
        pass(bloomA!, bloomB!, 1, spread, 0);
        pass(bloomB!, bloomA!, 1, 0, spread);
      }

      // ----- Post → screen -----
      bind(null, w, h);
      gl.useProgram(post);
      sample(SAMPLER_A, sceneTarget!);
      sample(SAMPLER_B, bloomA!);
      pu.i('uScene', SAMPLER_A);
      pu.i('uBloom', SAMPLER_B);
      pu.f('uResolution', w, h);
      pu.f('uTime', frame.time % 3600);
      pu.f('uExposure', params.exposure);
      pu.f('uBloomStrength', params.bloom);
      pu.f('uGrain', params.grain);
      pu.f('uVignette', params.vignette);
      pu.i('uRaw', viewIndex === 0 ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
