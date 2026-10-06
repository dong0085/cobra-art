// Owns the WebGL2 context. Each frame: scene → whiskers → bloom (¼ size) → post → screen.
import { BAKE_SCALE, DISTANCE_LEVELS, REGION_ROWS, SILHOUETTE_LEVELS, type Baked } from '../bake/bake.ts';
import { createProgram, createTarget, createTexture, deleteTarget, uniforms, type Target } from './webgl.ts';
import type { FrameState } from '../director/director.ts';
import { VIEWS, type Params } from '../params.ts';
import type { Art } from '../art/load.ts';
import type { Subject } from '../subjects/subject.ts';
import vertexSrc from '../shaders/fullscreen.vert?raw';
import commonSrc from '../shaders/common.glsl?raw';
import sceneSrc from '../shaders/scene.frag?raw';
import bloomSrc from '../shaders/bloom.frag?raw';
import postSrc from '../shaders/post.frag?raw';
import whiskerVertSrc from '../shaders/whisker.vert?raw';
import whiskerFragSrc from '../shaders/whisker.frag?raw';

const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
/** Upper limit on rendered pixels (before the quality slider); keeps big screens smooth. */
const MAX_PIXELS = 2_600_000;

export type Renderer = {
  draw(frame: FrameState, params: Params): void;
};

export function createRenderer(canvas: HTMLCanvasElement, baked: Baked, art: Art, subject: Subject): Renderer {
  const { width: artWidth, height: artHeight } = art;
  const { layout, look } = subject;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  const hdr = !!gl.getExtension('EXT_color_buffer_float');

  const scene = createProgram(gl, vertexSrc, HEADER + commonSrc + sceneSrc);
  const bloom = createProgram(gl, vertexSrc, HEADER + bloomSrc);
  const post = createProgram(gl, vertexSrc, HEADER + commonSrc + postSrc);
  const whiskerProgram = createProgram(gl, HEADER + whiskerVertSrc, HEADER + whiskerFragSrc);
  const su = uniforms(gl, scene);
  const bu = uniforms(gl, bloom);
  const pu = uniforms(gl, post);
  const wu = uniforms(gl, whiskerProgram);
  const fullscreen = gl.createVertexArray(); // the full-screen triangle needs no attributes
  const whiskers = buildWhiskers(gl, whiskerProgram, art.whiskers, look.snout);

  // Baked textures live on units 0–7 for the whole session.
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
    ['uForm', createTexture(gl, { width: artWidth, height: artHeight, internalFormat: gl.R16F, format: gl.RED, type: gl.FLOAT, data: baked.form, smooth: true })],
    [
      'uStrands',
      createTexture(gl, { width: baked.strandsSize[0], height: baked.strandsSize[1], internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, data: baked.strands, smooth: true }),
    ],
    [
      'uFlow',
      createTexture(gl, { width: baked.flowSize[0], height: baked.flowSize[1], internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, data: baked.flow, smooth: true }),
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
  // Things about the subject that never change.
  su.f('uKeyPool', ...look.keyPool);
  su.f('uEye', ...look.eye);
  su.f('uFade', ...(look.fade ?? [0, 0, 0, 0]));
  su.f('uFadeOn', look.fade ? 1 : 0);
  su.f('uGround', ...(look.ground ?? [0, 0, 1, 1]));
  su.f('uGroundOn', look.ground ? 1 : 0);
  su.i('uPatternMode', look.pattern.kind === 'bands' ? 0 : 1);
  su.f('uBellyZone', ...(look.pattern.kind === 'belly' ? look.pattern.zone : [0, 0, 1]));
  su.f('uBevelAll', look.bevelAll ? 1 : 0);
  su.f('uStrandDepth', look.strandDepth);
  su.f('uInkDarken', look.inkDarken);
  su.f('uDarkFloorOnBody', look.darkFloorOnBody ? 1 : 0);
  su.f('uShadowSoftness', look.shadowSoftness);
  const SAMPLER_A = 8; // units for sampling render targets
  const SAMPLER_B = 9;
  const SCRATCH_UNIT = 10; // where new textures get created

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
    gl!.activeTexture(gl!.TEXTURE0 + SCRATCH_UNIT); // keep the baked textures bound on units 0–7
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

      // Layout: the animal stands near the bottom edge, a little left of centre.
      const artScale = Math.min((h * layout.fit) / artHeight, w / artWidth);
      const originX = (w - artWidth * artScale) * layout.across;
      const originY = h * (1 - layout.bottom) - artHeight * artScale;

      // ----- Scene -----
      bind(sceneTarget, w, h);
      gl.bindVertexArray(fullscreen);
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
      su.f('uBody', ...m.body);
      su.f('uPattern', ...m.pattern);
      su.f('uPatternAmount', m.patternAmount);
      su.f('uBelly', ...m.belly);
      su.f('uSkin', ...m.skin);
      su.f('uNose', ...m.nose);
      su.f('uFur', m.fur);
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
      su.f('uSpot', originX + look.spot[0] * artScale, originY + look.spot[1] * artScale);
      su.f('uSpotRadius', h * 0.5);
      su.f('uBevel', params.bevel);
      su.f('uRelief', params.relief);
      su.f('uSpecular', params.specular);
      su.f('uMetalBias', params.metalBias);
      su.f('uShadows', params.shadows);
      su.f('uSpotAmount', params.spot);
      su.f('uDustAmount', params.dust);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ----- Whiskers, blended over the scene -----
      if (whiskers.count > 0 && viewIndex === 0) {
        gl.useProgram(whiskerProgram);
        gl.bindVertexArray(whiskers.vao);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        wu.f('uResolution', w, h);
        wu.f('uArtOrigin', originX, originY);
        wu.f('uArtScale', artScale);
        wu.f('uTime', frame.time % 3600);
        wu.f('uWhisk', frame.whisk);
        wu.f('uWind', frame.rippleStrength);
        wu.f('uColor', ...m.whisker);
        wu.f('uKey', ...m.key);
        wu.f('uRim', ...m.rim);
        wu.f('uAmbient', ...m.ambient);
        for (const [first, count] of whiskers.strips) gl.drawArrays(gl.TRIANGLE_STRIP, first, count);
        gl.disable(gl.BLEND);
        gl.bindVertexArray(fullscreen);
      }

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

/** Turns whisker centre lines into triangle strips: two vertices per point, one on each side. */
function buildWhiskers(gl: WebGL2RenderingContext, program: WebGLProgram, lines: number[][], snout: [number, number]) {
  const FLOATS = 8; // pos.xy, normal.xy, bend, side, phase, width
  const data: number[] = [];
  const strips: [number, number][] = [];
  for (const line of lines) {
    const n = line.length / 2;
    if (n < 2) continue;
    const at = (i: number) => [line[i * 2], line[i * 2 + 1]];
    const [rx, ry] = at(0);
    const rootDist = Math.hypot(rx - snout[0], ry - snout[1]);
    const phase = Math.atan2(ry - snout[1], rx - snout[0]) * 3;
    let length = 0;
    for (let i = 1; i < n; i++) length += Math.hypot(at(i)[0] - at(i - 1)[0], at(i)[1] - at(i - 1)[1]);
    let along = 0;
    strips.push([data.length / FLOATS, n * 2]);
    for (let i = 0; i < n; i++) {
      const [x, y] = at(i);
      if (i > 0) along += Math.hypot(x - at(i - 1)[0], y - at(i - 1)[1]);
      const [ax, ay] = at(Math.max(0, i - 1));
      const [bx, by] = at(Math.min(n - 1, i + 1));
      const tl = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / tl;
      const ny = (bx - ax) / tl;
      const bend = Math.min(1, Math.max(0, (Math.hypot(x - snout[0], y - snout[1]) - rootDist) / 260));
      const width = 2.2 + (0.7 - 2.2) * (along / Math.max(length, 1));
      for (const side of [-1, 1]) data.push(x, y, nx, ny, bend, side, phase, width);
    }
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  const attributes: [string, number, number][] = [
    ['aPos', 2, 0],
    ['aNormal', 2, 2],
    ['aBend', 1, 4],
    ['aSide', 1, 5],
    ['aPhase', 1, 6],
    ['aWidth', 1, 7],
  ];
  for (const [name, size, offset] of attributes) {
    const location = gl.getAttribLocation(program, name);
    if (location < 0) continue;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, FLOATS * 4, offset * 4);
  }
  gl.bindVertexArray(null);
  return { vao, strips, count: strips.length };
}
