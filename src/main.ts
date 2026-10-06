import './style.css';
import cobraSvg from './art/cobra.svg?raw';
import { parseArt } from './art/load.ts';
import { runBake } from './bake/run.ts';
import { createRenderer, type Renderer } from './gl/renderer.ts';
import { Director } from './director/director.ts';
import { params, VIEWS, type View } from './params.ts';
import { createPanel } from './ui/panel.ts';
import { setupShowMode } from './ui/show.ts';
import { showFallback } from './fallback.ts';

const FPS = 30;

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const status = document.querySelector<HTMLElement>('#status')!;

// URL options: ?show  ?t=600 (start at 10 min)  ?seed=7  ?view=normals  ?mood=2  ?panel  ?capture
const url = new URLSearchParams(location.search);
const seed = Number(url.get('seed') ?? 1) || 1;
const startTime = Number(url.get('t') ?? 0) || 0;
if (url.get('view') && url.get('view')! in VIEWS) params.view = url.get('view') as View;

const formatClock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

async function start() {
  status.textContent = '准备中…';
  const art = parseArt(cobraSvg);
  const t0 = performance.now();
  const baked = await runBake(art);
  const bakeMs = Math.round(performance.now() - t0);

  let renderer: Renderer;
  try {
    renderer = createRenderer(canvas, baked, art.width, art.height);
  } catch (err) {
    status.textContent = '这个浏览器不支持 WebGL2，显示静态版本。';
    showFallback(cobraSvg, String(err));
    return;
  }

  const director = new Director(seed);
  if (url.has('mood')) {
    params.mood = Number(url.get('mood'));
    director.lockedMood = params.mood;
  }

  let t = startTime;
  const now = () => t;
  const panel = createPanel(params, director, now);
  if (!url.has('panel')) panel.hide();
  setupShowMode(params, director, panel, now, url.has('show'));

  // ?capture: no live clock. scripts/timelapse.ts calls renderAt(t) for each frame it records.
  if (url.has('capture')) {
    document.body.classList.add('show');
    (window as any).renderAt = (time: number) => renderer.draw(director.frame(time), params);
    return;
  }

  let lastTick = performance.now();
  let lastDraw = -Infinity;
  const frame = (ms: number) => {
    const dt = Math.min((ms - lastTick) / 1000, 0.25); // a hidden tab simply pauses
    lastTick = ms;
    if (!params.paused) t += dt * params.speed;
    if (ms - lastDraw >= 1000 / FPS - 2) {
      lastDraw = ms;
      const state = director.frame(t);
      renderer.draw(state, params);
      status.textContent = `${state.moodName}${state.eventName ? ` · ${state.eventName}` : ''} · ${formatClock(t)} · 烘焙 ${bakeMs} ms`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start().catch((err) => {
  status.textContent = String(err?.message ?? err);
  console.error(err);
});
